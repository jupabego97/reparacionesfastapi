"""consolidate schema remove runtime migrations

Revision ID: 3f8c9b2c1d4e
Revises: e22afad59dd6
Create Date: 2026-02-14 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = '3f8c9b2c1d4e'
down_revision: Union[str, Sequence[str], None] = 'e22afad59dd6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(inspector, table_name: str) -> bool:
    return table_name in inspector.get_table_names()


def _has_column(inspector, table_name: str, column_name: str) -> bool:
    if not _has_table(inspector, table_name):
        return False
    return column_name in {c['name'] for c in inspector.get_columns(table_name)}


def _has_index(inspector, table_name: str, index_name: str) -> bool:
    if not _has_table(inspector, table_name):
        return False
    return index_name in {idx['name'] for idx in inspector.get_indexes(table_name)}


def _safe_create_index(inspector, index_name: str, table_name: str, columns: list[str], unique: bool = False) -> None:
    if not _has_index(inspector, table_name, index_name):
        op.create_index(index_name, table_name, columns, unique=unique)


def _rename_or_drop_legacy_columns(inspector, dialect: str) -> None:
    if not _has_table(inspector, 'repair_cards') or dialect != 'postgresql':
        return

    conn = op.get_bind()
    existing = {c['name'] for c in inspector.get_columns('repair_cards')}
    renames = [
        ('prioridad', 'priority'),
        ('asignado_nombre', 'assigned_name'),
        ('costo_estimado', 'estimated_cost'),
        ('costo_final', 'final_cost'),
        ('notas_costo', 'cost_notes'),
    ]

    for old_name, new_name in renames:
        if old_name in existing and new_name not in existing:
            conn.execute(sa.text(f'ALTER TABLE repair_cards RENAME COLUMN {old_name} TO {new_name}'))
            existing.discard(old_name)
            existing.add(new_name)
        elif old_name in existing and new_name in existing:
            conn.execute(sa.text(f'ALTER TABLE repair_cards DROP COLUMN {old_name}'))
            existing.discard(old_name)


def _ensure_users_table(inspector) -> None:
    if _has_table(inspector, 'users'):
        return

    op.create_table(
        'users',
        sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
        sa.Column('username', sa.Text(), nullable=False),
        sa.Column('email', sa.Text(), nullable=True),
        sa.Column('hashed_password', sa.Text(), nullable=False),
        sa.Column('full_name', sa.Text(), nullable=False),
        sa.Column('role', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=False),
        sa.Column('avatar_color', sa.Text(), nullable=True),
        sa.Column('created_at', sa.DateTime(), nullable=False),
        sa.Column('last_login', sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )


def _ensure_kanban_tables(inspector) -> None:
    if not _has_table(inspector, 'kanban_columns'):
        op.create_table(
            'kanban_columns',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('key', sa.Text(), nullable=False),
            sa.Column('title', sa.Text(), nullable=False),
            sa.Column('color', sa.Text(), nullable=False),
            sa.Column('icon', sa.Text(), nullable=True),
            sa.Column('position', sa.Integer(), nullable=False),
            sa.Column('wip_limit', sa.Integer(), nullable=True),
            sa.Column('is_done_column', sa.Boolean(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.PrimaryKeyConstraint('id'),
        )

    if not _has_table(inspector, 'tags'):
        op.create_table(
            'tags',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('name', sa.Text(), nullable=False),
            sa.Column('color', sa.Text(), nullable=False),
            sa.Column('icon', sa.Text(), nullable=True),
            sa.PrimaryKeyConstraint('id'),
        )

    if not _has_table(inspector, 'subtasks'):
        op.create_table(
            'subtasks',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('tarjeta_id', sa.Integer(), nullable=False),
            sa.Column('title', sa.Text(), nullable=False),
            sa.Column('completed', sa.Boolean(), nullable=False),
            sa.Column('position', sa.Integer(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.Column('completed_at', sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(['tarjeta_id'], ['repair_cards.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )

    if not _has_table(inspector, 'comments'):
        op.create_table(
            'comments',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('tarjeta_id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('author_name', sa.Text(), nullable=False),
            sa.Column('content', sa.Text(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['tarjeta_id'], ['repair_cards.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='SET NULL'),
            sa.PrimaryKeyConstraint('id'),
        )

    if not _has_table(inspector, 'notifications'):
        op.create_table(
            'notifications',
            sa.Column('id', sa.Integer(), autoincrement=True, nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=True),
            sa.Column('tarjeta_id', sa.Integer(), nullable=True),
            sa.Column('title', sa.Text(), nullable=False),
            sa.Column('message', sa.Text(), nullable=False),
            sa.Column('type', sa.Text(), nullable=False),
            sa.Column('read', sa.Boolean(), nullable=False),
            sa.Column('created_at', sa.DateTime(), nullable=False),
            sa.ForeignKeyConstraint(['tarjeta_id'], ['repair_cards.id'], ondelete='SET NULL'),
            sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )

    if not _has_table(inspector, 'repair_card_tags'):
        op.create_table(
            'repair_card_tags',
            sa.Column('repair_card_id', sa.Integer(), nullable=False),
            sa.Column('tag_id', sa.Integer(), nullable=False),
            sa.ForeignKeyConstraint(['repair_card_id'], ['repair_cards.id'], ondelete='CASCADE'),
            sa.ForeignKeyConstraint(['tag_id'], ['tags.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('repair_card_id', 'tag_id'),
        )


def upgrade() -> None:
    bind = op.get_bind()
    inspector = inspect(bind)
    dialect = bind.dialect.name

    _rename_or_drop_legacy_columns(inspector, dialect)
    inspector = inspect(bind)

    _ensure_users_table(inspector)
    _ensure_kanban_tables(inspector)
    inspector = inspect(bind)

    if _has_table(inspector, 'repair_cards'):
        with op.batch_alter_table('repair_cards') as batch_op:
            if not _has_column(inspector, 'repair_cards', 'priority'):
                batch_op.add_column(sa.Column('priority', sa.Text(), nullable=False, server_default='media'))
            if not _has_column(inspector, 'repair_cards', 'position'):
                batch_op.add_column(sa.Column('position', sa.Integer(), nullable=False, server_default='0'))
            if not _has_column(inspector, 'repair_cards', 'assigned_to'):
                batch_op.add_column(sa.Column('assigned_to', sa.Integer(), nullable=True))
            if not _has_column(inspector, 'repair_cards', 'assigned_name'):
                batch_op.add_column(sa.Column('assigned_name', sa.Text(), nullable=True))
            if not _has_column(inspector, 'repair_cards', 'estimated_cost'):
                batch_op.add_column(sa.Column('estimated_cost', sa.Float(), nullable=True))
            if not _has_column(inspector, 'repair_cards', 'final_cost'):
                batch_op.add_column(sa.Column('final_cost', sa.Float(), nullable=True))
            if not _has_column(inspector, 'repair_cards', 'cost_notes'):
                batch_op.add_column(sa.Column('cost_notes', sa.Text(), nullable=True))
            if not _has_column(inspector, 'repair_cards', 'deleted_at'):
                batch_op.add_column(sa.Column('deleted_at', sa.DateTime(), nullable=True))

    inspector = inspect(bind)

    if _has_table(inspector, 'status_history'):
        with op.batch_alter_table('status_history') as batch_op:
            if not _has_column(inspector, 'status_history', 'changed_by'):
                batch_op.add_column(sa.Column('changed_by', sa.Integer(), nullable=True))
            if not _has_column(inspector, 'status_history', 'changed_by_name'):
                batch_op.add_column(sa.Column('changed_by_name', sa.Text(), nullable=True))

    inspector = inspect(bind)

    # Índices/constraints adicionales
    _safe_create_index(inspector, 'ix_users_username', 'users', ['username'])
    _safe_create_index(inspector, 'ix_users_email', 'users', ['email'])
    _safe_create_index(inspector, 'ix_users_role', 'users', ['role'])

    _safe_create_index(inspector, 'ix_kanban_columns_key', 'kanban_columns', ['key'])
    _safe_create_index(inspector, 'ix_tags_name', 'tags', ['name'])
    _safe_create_index(inspector, 'ix_subtasks_tarjeta_id', 'subtasks', ['tarjeta_id'])
    _safe_create_index(inspector, 'ix_comments_tarjeta_id', 'comments', ['tarjeta_id'])
    _safe_create_index(inspector, 'ix_comments_user_id', 'comments', ['user_id'])
    _safe_create_index(inspector, 'ix_notifications_user_id', 'notifications', ['user_id'])
    _safe_create_index(inspector, 'ix_notifications_read', 'notifications', ['read'])
    _safe_create_index(inspector, 'ix_notifications_created_at', 'notifications', ['created_at'])

    _safe_create_index(inspector, 'ix_repair_cards_priority', 'repair_cards', ['priority'])
    _safe_create_index(inspector, 'ix_repair_cards_position', 'repair_cards', ['position'])
    _safe_create_index(inspector, 'ix_repair_cards_assigned_to', 'repair_cards', ['assigned_to'])
    _safe_create_index(inspector, 'ix_repair_cards_deleted_at', 'repair_cards', ['deleted_at'])

    _safe_create_index(inspector, 'ix_status_history_changed_by', 'status_history', ['changed_by'])

    # FKs que no existían en revisiones antiguas
    inspector = inspect(bind)
    if _has_table(inspector, 'repair_cards'):
        fk_columns = {tuple(fk.get('constrained_columns', [])) for fk in inspector.get_foreign_keys('repair_cards')}
        if ('assigned_to',) not in fk_columns:
            with op.batch_alter_table('repair_cards') as batch_op:
                batch_op.create_foreign_key('fk_repair_cards_assigned_to_users', 'users', ['assigned_to'], ['id'], ondelete='SET NULL')

    if _has_table(inspector, 'status_history'):
        fk_columns = {tuple(fk.get('constrained_columns', [])) for fk in inspector.get_foreign_keys('status_history')}
        if ('changed_by',) not in fk_columns:
            with op.batch_alter_table('status_history') as batch_op:
                batch_op.create_foreign_key('fk_status_history_changed_by_users', 'users', ['changed_by'], ['id'], ondelete='SET NULL')


def downgrade() -> None:
    # No se intenta rollback destructivo de consolidación histórica.
    raise NotImplementedError('Downgrade no soportado para migración de consolidación.')
