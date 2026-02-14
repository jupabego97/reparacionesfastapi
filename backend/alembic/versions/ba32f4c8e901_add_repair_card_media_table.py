"""add repair_card_media table

Revision ID: ba32f4c8e901
Revises: 9a7c11a4d2ef
Create Date: 2026-02-14
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "ba32f4c8e901"
down_revision: Union[str, None] = "9a7c11a4d2ef"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "repair_card_media",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tarjeta_id", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.Text(), nullable=True),
        sa.Column("url", sa.Text(), nullable=False),
        sa.Column("thumb_url", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_cover", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("mime_type", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("deleted_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["tarjeta_id"], ["repair_cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_repair_card_media_tarjeta_id", "repair_card_media", ["tarjeta_id"], unique=False)
    op.create_index("ix_repair_card_media_deleted_at", "repair_card_media", ["deleted_at"], unique=False)
    op.create_index(
        "ix_repair_card_media_tarjeta_position_cover",
        "repair_card_media",
        ["tarjeta_id", "position", "is_cover"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_repair_card_media_tarjeta_position_cover", table_name="repair_card_media")
    op.drop_index("ix_repair_card_media_deleted_at", table_name="repair_card_media")
    op.drop_index("ix_repair_card_media_tarjeta_id", table_name="repair_card_media")
    op.drop_table("repair_card_media")
