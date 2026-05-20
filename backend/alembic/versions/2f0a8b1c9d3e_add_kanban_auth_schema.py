"""add kanban/auth schema before performance indexes

Revision ID: 2f0a8b1c9d3e
Revises: e22afad59dd6
Create Date: 2026-05-20
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "2f0a8b1c9d3e"
down_revision: Union[str, None] = "e22afad59dd6"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # --- repair_cards: columnas usadas por el modelo actual ---
    with op.batch_alter_table("repair_cards", schema=None) as batch_op:
        batch_op.add_column(sa.Column("priority", sa.Text(), nullable=False, server_default="media"))
        batch_op.add_column(sa.Column("position", sa.Integer(), nullable=False, server_default="0"))
        batch_op.add_column(sa.Column("assigned_to", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("assigned_name", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("estimated_cost", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("final_cost", sa.Float(), nullable=True))
        batch_op.add_column(sa.Column("cost_notes", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("deleted_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("blocked_at", sa.DateTime(), nullable=True))
        batch_op.add_column(sa.Column("blocked_reason", sa.Text(), nullable=True))
        batch_op.add_column(sa.Column("blocked_by", sa.Integer(), nullable=True))

    op.create_table(
        "users",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("username", sa.Text(), nullable=False),
        sa.Column("email", sa.Text(), nullable=True),
        sa.Column("hashed_password", sa.Text(), nullable=False),
        sa.Column("full_name", sa.Text(), nullable=False, server_default="Usuario"),
        sa.Column("role", sa.Text(), nullable=False, server_default="tecnico"),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.text("true")),
        sa.Column("avatar_color", sa.Text(), nullable=True, server_default="#00ACC1"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("last_login", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_users_username", "users", ["username"], unique=True)
    op.create_index("ix_users_email", "users", ["email"], unique=True)
    op.create_index("ix_users_role", "users", ["role"], unique=False)

    with op.batch_alter_table("repair_cards", schema=None) as batch_op:
        batch_op.create_foreign_key(
            "fk_repair_cards_assigned_to_users",
            "users",
            ["assigned_to"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.create_foreign_key(
            "fk_repair_cards_blocked_by_users",
            "users",
            ["blocked_by"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_table(
        "kanban_columns",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("color", sa.Text(), nullable=False, server_default="#0369a1"),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("wip_limit", sa.Integer(), nullable=True),
        sa.Column("is_done_column", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("sla_hours", sa.Integer(), nullable=True),
        sa.Column("required_fields", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_kanban_columns_key", "kanban_columns", ["key"], unique=True)

    op.create_table(
        "tags",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("color", sa.Text(), nullable=False, server_default="#6366f1"),
        sa.Column("icon", sa.Text(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_tags_name", "tags", ["name"], unique=True)

    op.create_table(
        "repair_card_tags",
        sa.Column("repair_card_id", sa.Integer(), nullable=False),
        sa.Column("tag_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["repair_card_id"], ["repair_cards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("repair_card_id", "tag_id"),
    )

    op.create_table(
        "subtasks",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tarjeta_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("completed", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["tarjeta_id"], ["repair_cards.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_subtasks_tarjeta_id", "subtasks", ["tarjeta_id"], unique=False)

    op.create_table(
        "comments",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("tarjeta_id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("author_name", sa.Text(), nullable=False, server_default="Sistema"),
        sa.Column("content", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["tarjeta_id"], ["repair_cards.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_comments_tarjeta_id", "comments", ["tarjeta_id"], unique=False)
    op.create_index("ix_comments_user_id", "comments", ["user_id"], unique=False)

    op.create_table(
        "notifications",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=True),
        sa.Column("tarjeta_id", sa.Integer(), nullable=True),
        sa.Column("title", sa.Text(), nullable=False),
        sa.Column("message", sa.Text(), nullable=False),
        sa.Column("type", sa.Text(), nullable=False, server_default="info"),
        sa.Column("read", sa.Boolean(), nullable=False, server_default=sa.text("false")),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["tarjeta_id"], ["repair_cards.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_notifications_user_id", "notifications", ["user_id"], unique=False)
    op.create_index("ix_notifications_read", "notifications", ["read"], unique=False)
    op.create_index("ix_notifications_created_at", "notifications", ["created_at"], unique=False)

    op.create_table(
        "card_templates",
        sa.Column("id", sa.Integer(), autoincrement=True, nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("problem_template", sa.Text(), nullable=True),
        sa.Column("default_priority", sa.Text(), nullable=False, server_default="media"),
        sa.Column("default_notes", sa.Text(), nullable=True),
        sa.Column("estimated_hours", sa.Float(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.text("CURRENT_TIMESTAMP")),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("name"),
    )


def downgrade() -> None:
    op.drop_table("card_templates")
    op.drop_index("ix_notifications_created_at", table_name="notifications")
    op.drop_index("ix_notifications_read", table_name="notifications")
    op.drop_index("ix_notifications_user_id", table_name="notifications")
    op.drop_table("notifications")
    op.drop_index("ix_comments_user_id", table_name="comments")
    op.drop_index("ix_comments_tarjeta_id", table_name="comments")
    op.drop_table("comments")
    op.drop_index("ix_subtasks_tarjeta_id", table_name="subtasks")
    op.drop_table("subtasks")
    op.drop_table("repair_card_tags")
    op.drop_index("ix_tags_name", table_name="tags")
    op.drop_table("tags")
    op.drop_index("ix_kanban_columns_key", table_name="kanban_columns")
    op.drop_table("kanban_columns")

    with op.batch_alter_table("repair_cards", schema=None) as batch_op:
        batch_op.drop_constraint("fk_repair_cards_blocked_by_users", type_="foreignkey")
        batch_op.drop_constraint("fk_repair_cards_assigned_to_users", type_="foreignkey")
        batch_op.drop_column("blocked_by")
        batch_op.drop_column("blocked_reason")
        batch_op.drop_column("blocked_at")
        batch_op.drop_column("deleted_at")
        batch_op.drop_column("cost_notes")
        batch_op.drop_column("final_cost")
        batch_op.drop_column("estimated_cost")
        batch_op.drop_column("assigned_name")
        batch_op.drop_column("assigned_to")
        batch_op.drop_column("position")
        batch_op.drop_column("priority")

    op.drop_index("ix_users_role", table_name="users")
    op.drop_index("ix_users_email", table_name="users")
    op.drop_index("ix_users_username", table_name="users")
    op.drop_table("users")
