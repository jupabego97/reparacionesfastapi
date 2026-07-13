"""Add audit fields to status_history (action, client_ip, details)

Revision ID: f1a2b3c4d5e6
Revises: e5f9a2b4c6d0
Create Date: 2026-07-13
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, None] = "e5f9a2b4c6d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    with op.batch_alter_table("status_history", schema=None) as batch_op:
        batch_op.add_column(sa.Column("action", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("client_ip", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("details", sa.Text(), nullable=True))

    op.execute("UPDATE status_history SET action = 'status_changed' WHERE action IS NULL")

    with op.batch_alter_table("status_history", schema=None) as batch_op:
        batch_op.alter_column("action", nullable=False, server_default="status_changed")

    op.create_index(
        "ix_status_history_tarjeta_changed_action",
        "status_history",
        ["tarjeta_id", "changed_at", "action"],
    )


def downgrade() -> None:
    op.drop_index("ix_status_history_tarjeta_changed_action", table_name="status_history")
    with op.batch_alter_table("status_history", schema=None) as batch_op:
        batch_op.drop_column("details")
        batch_op.drop_column("client_ip")
        batch_op.drop_column("action")
