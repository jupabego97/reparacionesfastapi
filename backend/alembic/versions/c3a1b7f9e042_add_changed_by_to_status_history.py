"""add changed_by columns to status_history

Revision ID: c3a1b7f9e042
Revises: ba32f4c8e901
Create Date: 2026-02-16

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c3a1b7f9e042"
down_revision: Union[str, None] = "ba32f4c8e901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("status_history", sa.Column("changed_by", sa.Integer(), nullable=True))
    op.add_column("status_history", sa.Column("changed_by_name", sa.Text(), nullable=True))
    op.create_foreign_key(
        "fk_status_history_changed_by_users",
        "status_history",
        "users",
        ["changed_by"],
        ["id"],
        ondelete="SET NULL",
    )


def downgrade() -> None:
    op.drop_constraint("fk_status_history_changed_by_users", "status_history", type_="foreignkey")
    op.drop_column("status_history", "changed_by_name")
    op.drop_column("status_history", "changed_by")
