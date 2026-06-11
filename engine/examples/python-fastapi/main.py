from fastapi import FastAPI

app = FastAPI(title="Example API")

@app.get("/health")
def health():
    return {"status": "ok"}
