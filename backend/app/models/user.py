from datetime import datetime, timezone
from sqlalchemy import Column, Integer, Text, DateTime, Boolean
from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, autoincrement=True)
    username = Column(Text, unique=True, nullable=False, index=True)
    email = Column(Text, unique=True, nullable=True, index=True)
    hashed_password = Column(Text, nullable=False)
    full_name = Column(Text, nullable=False, default="Usuario")
    role = Column(Text, nullable=False, default="tecnico", index=True)  # admin, tecnico, recepcion
    is_active = Column(Boolean, nullable=False, default=True)
    avatar_color = Column(Text, nullable=True, default="#00ACC1")
    created_at = Column(DateTime, nullable=False, default=lambda: datetime.now(timezone.utc))
    last_login = Column(DateTime, nullable=True)

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "username": self.username,
            "email": self.email,
            "full_name": self.full_name,
            "role": self.role,
            "is_active": self.is_active,
            "avatar_color": self.avatar_color,
            "created_at": self.created_at.strftime("%Y-%m-%d %H:%M:%S") if self.created_at else None,
            "last_login": self.last_login.strftime("%Y-%m-%d %H:%M:%S") if self.last_login else None,
        }
