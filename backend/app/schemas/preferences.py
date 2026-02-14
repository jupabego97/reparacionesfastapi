from pydantic import BaseModel, Field


class UserPreferences(BaseModel):
    saved_views: list[dict] = Field(default_factory=list)
    default_view: str | None = None
    density: str = "comfortable"
    theme: str = "dark"
    mobile_behavior: str = "horizontal_swipe"
