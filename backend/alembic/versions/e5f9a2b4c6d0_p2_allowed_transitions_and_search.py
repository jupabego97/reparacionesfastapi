"""P2: allowed_destinations on kanban_columns + pg_trgm search indexes

Revision ID: e5f9a2b4c6d0
Revises: d4e8f1a2b3c9
Create Date: 2026-07-09
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "e5f9a2b4c6d0"
down_revision: Union[str, None] = "d4e8f1a2b3c9"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_DEFAULT_TRANSITIONS = {
    "ingresado": '["diagnosticada"]',
    "diagnosticada": '["para_entregar", "ingresado"]',
    "para_entregar": '["listos", "diagnosticada"]',
    "listos": '["para_entregar"]',
}


def upgrade() -> None:
    with op.batch_alter_table("kanban_columns", schema=None) as batch_op:
        batch_op.add_column(sa.Column("allowed_destinations", sa.Text(), nullable=True))

    for key, value in _DEFAULT_TRANSITIONS.items():
        op.execute(
            sa.text(
                "UPDATE kanban_columns SET allowed_destinations = :val WHERE key = :key"
            ).bindparams(val=value, key=key)
        )

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
        for col in ("owner_name", "problem", "whatsapp_number", "technical_notes"):
            op.execute(
                f"CREATE INDEX IF NOT EXISTS ix_repair_cards_{col}_trgm "
                f"ON repair_cards USING gin ({col} gin_trgm_ops)"
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        for col in ("owner_name", "problem", "whatsapp_number", "technical_notes"):
            op.execute(f"DROP INDEX IF EXISTS ix_repair_cards_{col}_trgm")

    with op.batch_alter_table("kanban_columns", schema=None) as batch_op:
        batch_op.drop_column("allowed_destinations")
