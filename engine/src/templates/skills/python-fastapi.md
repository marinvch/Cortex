# FastAPI Patterns — {{PROJECT_NAME}}

## Route Patterns

```python
from fastapi import APIRouter, Depends, HTTPException, status
from app.dependencies import get_current_user
from app.schemas.item import ItemCreate, ItemResponse
from app.services.item import ItemService

router = APIRouter(prefix="/items", tags=["items"])

@router.get("/", response_model=list[ItemResponse])
async def list_items(
    current_user = Depends(get_current_user),
    service: ItemService = Depends()
) -> list[ItemResponse]:
    return await service.list(user_id=current_user.id)

@router.post("/", response_model=ItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item(
    payload: ItemCreate,
    current_user = Depends(get_current_user),
    service: ItemService = Depends()
) -> ItemResponse:
    return await service.create(user_id=current_user.id, data=payload)
```

## Pydantic Schemas

```python
from pydantic import BaseModel, EmailStr, Field
from datetime import datetime
from uuid import UUID

class ItemCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    description: str | None = None

class ItemResponse(BaseModel):
    id: UUID
    name: str
    created_at: datetime
    
    model_config = {"from_attributes": True}  # Pydantic v2 (replaces orm_mode)
```

## Dependency Injection

```python
# dependencies.py
from fastapi import Depends, HTTPException
from app.core.security import verify_token

async def get_current_user(token: str = Depends(oauth2_scheme)) -> User:
    payload = verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid credentials")
    user = await User.get(payload["sub"])
    if not user:
        raise HTTPException(status_code=401, detail="User not found")
    return user
```

## Error Handling

```python
from fastapi import HTTPException

raise HTTPException(status_code=404, detail="Item not found")
raise HTTPException(status_code=422, detail=[{"field": "name", "msg": "required"}])
```
