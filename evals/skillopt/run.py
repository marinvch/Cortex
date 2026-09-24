"""Train or evaluate a Cortex skill with SkillOpt, without patching SkillOpt.

    python evals/skillopt/run.py train --cortex-skill ship  [--cfg-options key=value ...]
    python evals/skillopt/run.py eval  --cortex-skill ship --skill path/to/best_skill.md --split valid_unseen

Needs a SkillOpt checkout (SKILLOPT_SRC) for its scripts/, and SkillOpt installed in the interpreter.
Registers the ``cortex_skill`` env into SkillOpt's lazy registry, then hands over to its own main().
Output lands in .cortex/skillopt/<skill>/ (gitignored): the proposal is reviewed, never auto-applied.
"""
from __future__ import annotations

import importlib.util
import os
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
SRC = Path(os.environ.get("SKILLOPT_SRC", "")).resolve()


def load_script(name: str):
    spec = importlib.util.spec_from_file_location(f"skillopt_{name}", SRC / "scripts" / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def seed_skill(skill: str, out: Path) -> Path:
    """The trainable document is the SKILL.md body. Frontmatter stays out: it is routing metadata,
    checked by tools/cortex-frontmatter.mjs, and an optimizer editing it could break discovery."""
    text = (REPO / "skills" / skill / "SKILL.md").read_text(encoding="utf-8")
    body = re.sub(r"\A---\r?\n.*?\r?\n---\r?\n", "", text, count=1, flags=re.S)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(body.lstrip(), encoding="utf-8")
    return out


def take(args: list[str], flag: str) -> str:
    i = args.index(flag)
    value = args[i + 1]
    del args[i:i + 2]
    return value


def main() -> None:
    if not (SRC / "scripts" / "train.py").exists():
        sys.exit("set SKILLOPT_SRC to a SkillOpt checkout (git clone https://github.com/microsoft/SkillOpt)")
    sys.path[:0] = [str(HERE), str(SRC)]
    mode, rest = sys.argv[1], sys.argv[2:]
    skill = take(rest, "--cortex-skill")
    out_root = REPO / ".cortex" / "skillopt" / skill
    init = seed_skill(skill, out_root / "initial_skill.md")

    script = load_script("train" if mode == "train" else "eval_only")
    from cortex_skill.adapter import CortexSkillAdapter
    original = script._register_builtins

    def register() -> None:
        original()
        script._ENV_REGISTRY["cortex_skill"] = CortexSkillAdapter

    script._register_builtins = register
    base = SRC / "configs" / "_base_" / "default.yaml"
    config = out_root / "config.yaml"
    config.write_text((HERE / "config.yaml").read_text(encoding="utf-8").replace("{{BASE}}", base.as_posix()), encoding="utf-8")
    common = ["--config", str(config), "--split_dir", (REPO / "evals" / "data" / skill).as_posix()]
    if mode == "train":
        sys.argv = ["train.py", *common, "--out_root", str(out_root / "run"),
                    "--cfg-options", f"env.skill_init={init.as_posix()}", *rest]
    else:
        sys.argv = ["eval_only.py", *common, "--out_root", str(out_root / "eval"), *rest]
    script.main()


if __name__ == "__main__":
    main()
