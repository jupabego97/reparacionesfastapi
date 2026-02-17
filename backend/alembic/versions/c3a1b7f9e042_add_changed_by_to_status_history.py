"""add changed_by columns to status_history

Revision ID: c3a1b7f9e042
Revises: ba32f4c8e901
Create Date: 2026-02-16

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "c3a1b7f9e042"
down_revision: Union[str, None] = "ba32f4c8e901"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _column_exists(conn, table: str, column: str) -> bool:
    insp = inspect(conn)
    cols = [c["name"] for c in insp.get_columns(table)]
    return column in cols


def upgrade() -> None:
    conn = op.get_bind()
    if not _column_exists(conn, "status_history", "changed_by"):
        op.add_column("status_history", sa.Column("changed_by", sa.Integer(), nullable=True))
    if not _column_exists(conn, "status_history", "changed_by_name"):
        op.add_column("status_history", sa.Column("changed_by_name", sa.Text(), nullable=True))
    # SQLite no soporta ALTER ADD CONSTRAINT; PostgreSQL sí.
    if conn.dialect.name != "sqlite":
        insp = inspect(conn)
        fks = insp.get_foreign_keys("status_history")
        fk_exists = any(fk.get("name") == "fk_status_history_changed_by_users" for fk in fks)
        if not fk_exists:
            op.create_foreign_key(
                "fk_status_history_changed_by_users",
                "status_history",
                "users",
                ["changed_by"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name != "sqlite":
        op.drop_constraint("fk_status_history_changed_by_users", "status_history", type_="foreignkey")
    op.drop_column("status_history", "changed_by_name")
    op.drop_column("status_history", "changed_by")
