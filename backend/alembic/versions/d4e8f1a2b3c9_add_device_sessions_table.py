"""add device_sessions table for persistent device login

Revision ID: d4e8f1a2b3c9
Revises: c3a1b7f9e042
Create Date: 2026-03-03
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "d4e8f1a2b3c9"
down_revision: Union[str, None] = "c3a1b7f9e042"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "device_sessions",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("device_token", sa.Text(), nullable=False),
        sa.Column("device_name", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("device_token"),
    )
    op.create_index("ix_device_sessions_user_id", "device_sessions", ["user_id"])
    op.create_index("ix_device_sessions_device_token", "device_sessions", ["device_token"])


def downgrade() -> None:
    op.drop_index("ix_device_sessions_device_token", table_name="device_sessions")
    op.drop_index("ix_device_sessions_user_id", table_name="device_sessions")
    op.drop_table("device_sessions")
