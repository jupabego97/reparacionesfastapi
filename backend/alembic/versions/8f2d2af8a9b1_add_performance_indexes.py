"""add performance indexes for kanban board

Revision ID: 8f2d2af8a9b1
Revises: e22afad59dd6
Create Date: 2026-02-14
"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "8f2d2af8a9b1"
down_revision: Union[str, None] = "e22afad59dd6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_index(
        "ix_repair_cards_deleted_status_position",
        "repair_cards",
        ["deleted_at", "status", "position"],
        unique=False,
    )
    op.create_index(
        "ix_repair_cards_deleted_assigned",
        "repair_cards",
        ["deleted_at", "assigned_to"],
        unique=False,
    )
    op.create_index(
        "ix_repair_cards_deleted_priority",
        "repair_cards",
        ["deleted_at", "priority"],
        unique=False,
    )
    op.create_index(
        "ix_repair_card_tags_tag_card",
        "repair_card_tags",
        ["tag_id", "repair_card_id"],
        unique=False,
    )
    op.create_index(
        "ix_status_history_changed_tarjeta",
        "status_history",
        ["changed_at", "tarjeta_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_status_history_changed_tarjeta", table_name="status_history")
    op.drop_index("ix_repair_card_tags_tag_card", table_name="repair_card_tags")
    op.drop_index("ix_repair_cards_deleted_priority", table_name="repair_cards")
    op.drop_index("ix_repair_cards_deleted_assigned", table_name="repair_cards")
    op.drop_index("ix_repair_cards_deleted_status_position", table_name="repair_cards")
