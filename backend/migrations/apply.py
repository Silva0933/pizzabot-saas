"""
Runner simples de migrations SQL.

Aplica todos os arquivos .sql em ordem alfabética que ainda não foram aplicados.
Mantém histórico na tabela `schema_migrations`.

Uso (dentro do container):
    python migrations/apply.py
"""
import os
import sys
from pathlib import Path

import psycopg

MIGRATIONS_DIR = Path(__file__).parent


def get_db_url() -> str:
    url = os.environ.get("DATABASE_URL_SYNC")
    if not url:
        # Fallback: converter o asyncpg para sync
        async_url = os.environ.get("DATABASE_URL", "")
        url = async_url.replace("postgresql+asyncpg://", "postgresql://")
    if not url:
        raise RuntimeError("Defina DATABASE_URL_SYNC ou DATABASE_URL no ambiente.")
    return url


def ensure_migrations_table(cur):
    cur.execute("""
        CREATE TABLE IF NOT EXISTS public.schema_migrations (
            version TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    """)


def applied_versions(cur) -> set[str]:
    cur.execute("SELECT version FROM public.schema_migrations")
    return {row[0] for row in cur.fetchall()}


def apply_migration(cur, path: Path):
    version = path.stem
    print(f"  → aplicando {version}…", flush=True)
    sql = path.read_text(encoding="utf-8")
    cur.execute(sql)
    cur.execute(
        "INSERT INTO public.schema_migrations (version) VALUES (%s)",
        (version,),
    )


def run(verbose: bool = True) -> int:
    """Aplica migrations pendentes. Seguro para chamar de múltiplos processos:
    usa um advisory lock global pra serializar (o 2º processo espera o 1º)."""
    db_url = get_db_url()
    sql_files = sorted(MIGRATIONS_DIR.glob("*.sql"))

    if not sql_files:
        if verbose:
            print("Nenhum arquivo .sql encontrado em migrations/")
        return 0

    if verbose:
        print(f"Conectando em {db_url.split('@')[-1]}…")
    with psycopg.connect(db_url, autocommit=False) as conn:
        with conn.cursor() as cur:
            # Serializa execuções concorrentes (web + worker subindo juntos).
            cur.execute("SELECT pg_advisory_xact_lock(hashtext('pizzabot:migrations'))")
            ensure_migrations_table(cur)
            done = applied_versions(cur)

            pending = [p for p in sql_files if p.stem not in done]
            if not pending:
                if verbose:
                    print("✓ Tudo já aplicado.")
                return 0

            if verbose:
                print(f"{len(pending)} migration(s) pendente(s):")
            for p in pending:
                apply_migration(cur, p)
        conn.commit()
    if verbose:
        print("✓ Migrations aplicadas com sucesso.")
    return 0


def main() -> int:
    return run(verbose=True)


if __name__ == "__main__":
    sys.exit(main())
