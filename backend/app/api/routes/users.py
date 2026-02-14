import json

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.models.user import User, UserPreference
from app.schemas.preferences import UserPreferences
from app.services.auth_service import get_current_user

router = APIRouter(prefix='/api/users', tags=['users'])


def _default_preferences() -> UserPreferences:
    return UserPreferences()


@router.get('/me/preferences')
def get_my_preferences(
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    row = db.query(UserPreference).filter(UserPreference.user_id == user.id).first()
    raw = row.preferences_json if row else '{}'
    try:
        payload = json.loads(raw)
    except Exception:
        payload = {}
    prefs = UserPreferences(**payload)
    return prefs.model_dump()


@router.put('/me/preferences')
def update_my_preferences(
    data: UserPreferences,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    base = _default_preferences().model_dump()
    merged = {**base, **data.model_dump()}

    row = db.query(UserPreference).filter(UserPreference.user_id == user.id).first()
    if not row:
        row = UserPreference(user_id=user.id, preferences_json='{}')
        db.add(row)

    row.preferences_json = json.dumps(merged, ensure_ascii=True)
    db.commit()
    db.refresh(row)
    return merged
