"""SkillOpt environment for Cortex's skill evals.

Each task is a scenario rendered by ``evals/generate.mjs``; the skill document being trained is the
system prompt; the answer is scored by ``evals/score.mjs`` — the one scorer, shared with the Node
tests, so Python never re-implements a rule. The scorer's ``reason`` becomes ``fail_reason``, which
SkillOpt's reflection reads, so the optimizer is told *which* rule the answer broke.
"""
from __future__ import annotations

import json
import os
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from skillopt.datasets.base import BatchSpec, SplitDataLoader
from skillopt.envs.base import EnvAdapter
from skillopt.model import chat_target

EVALS = Path(__file__).resolve().parents[2]          # <repo>/evals
SCORER = EVALS / "score.mjs"


class CortexSkillLoader(SplitDataLoader):
    def load_split_items(self, split_path: str) -> list[dict]:
        with open(Path(split_path) / "tasks.json", encoding="utf-8") as f:
            return [dict(item, question=item["prompt"]) for item in json.load(f)]


def score_batch(pairs: list[tuple[dict, str]]) -> list[dict]:
    """One node process for the whole batch — the scorer is deterministic and cheap."""
    stdin = "\n".join(json.dumps({"task": t, "prediction": p}) for t, p in pairs) + "\n"
    proc = subprocess.run(["node", str(SCORER)], input=stdin, capture_output=True, text=True,
                          encoding="utf-8", check=True)
    return [json.loads(line) for line in proc.stdout.splitlines() if line.strip()]


class CortexSkillAdapter(EnvAdapter):
    def __init__(self, split_dir: str = "", data_path: str = "", split_mode: str = "split_dir",
                 split_ratio: str = "2:1:7", split_seed: int = 42, split_output_dir: str = "",
                 workers: int = 4, analyst_workers: int = 4, failure_only: bool = False,
                 minibatch_size: int = 8, edit_budget: int = 4, seed: int = 42, limit: int = 0,
                 max_completion_tokens: int = 4096) -> None:
        self.workers = workers
        self.analyst_workers = analyst_workers
        self.failure_only = failure_only
        self.minibatch_size = minibatch_size
        self.edit_budget = edit_budget
        self.max_completion_tokens = int(max_completion_tokens)
        self.dataloader = CortexSkillLoader(split_dir=split_dir, data_path=data_path,
                                            split_mode=split_mode, split_ratio=split_ratio,
                                            split_seed=split_seed, split_output_dir=split_output_dir,
                                            seed=seed, limit=limit)

    def setup(self, cfg: dict) -> None:
        super().setup(cfg)
        self.dataloader.setup(cfg)

    def get_dataloader(self):
        return self.dataloader

    def build_env_from_batch(self, batch: BatchSpec, **kwargs):
        return list(batch.payload or [])

    def build_train_env(self, batch_size: int, seed: int, **kwargs):
        return self.build_env_from_batch(self.dataloader.build_train_batch(batch_size=batch_size, seed=seed, **kwargs))

    def build_eval_env(self, env_num: int, split: str, seed: int, **kwargs):
        return self.build_env_from_batch(self.dataloader.build_eval_batch(env_num=env_num, split=split, seed=seed, **kwargs))

    def rollout(self, env_manager, skill_content: str, out_dir: str, **kwargs) -> list[dict]:
        items: list[dict] = env_manager
        pred_dir = Path(out_dir, "predictions")

        def one(item: dict) -> str:
            try:
                text, _usage = chat_target(system=skill_content, user=item["prompt"],
                                           max_completion_tokens=self.max_completion_tokens)
            except Exception as exc:  # a failed call is a failed task, not a crashed epoch
                text = f"(target call failed: {exc})"
            d = pred_dir / str(item["id"])
            d.mkdir(parents=True, exist_ok=True)
            (d / "conversation.json").write_text(json.dumps([
                {"role": "system", "content": skill_content},
                {"role": "user", "content": item["prompt"]},
                {"role": "assistant", "content": text},
            ], ensure_ascii=False, indent=2), encoding="utf-8")
            return text

        with ThreadPoolExecutor(max_workers=max(1, self.workers)) as pool:
            predictions = list(pool.map(one, items))
        scores = score_batch([({k: item[k] for k in ("id", "skill", "truth")}, p)
                              for item, p in zip(items, predictions)])
        results = []
        for item, pred, s in zip(items, predictions, scores):
            results.append({
                "id": str(item["id"]), "hard": int(s["hard"]), "soft": float(s["soft"]),
                "predicted_answer": pred[-1500:], "question": item["prompt"],
                "task_description": item["prompt"], "task_type": item.get("task_type", item["skill"]),
                "fail_reason": "" if s["hard"] else s["reason"],
                "target_system_prompt": skill_content, "target_user_prompt": item["prompt"], "n_turns": 1,
            })
        os.makedirs(out_dir, exist_ok=True)
        Path(out_dir, "rollouts.json").write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        return results

    def get_task_types(self) -> list[str]:
        seen: list[str] = []
        for item in self.dataloader.train_items + self.dataloader.val_items + self.dataloader.test_items:
            tt = str(item.get("task_type") or "cortex_skill")
            if tt not in seen:
                seen.append(tt)
        return seen or ["cortex_skill"]
