"""
Cria o primeiro usuário admin da plataforma.

Uso:
    python scripts/create_admin.py meu@email.com SenhaForte123 "Meu Nome"

Roda direto contra o banco (sync). Útil pra bootstrap inicial.
"""
import os
import sys
from pathlib import Path

import psycopg
from passlib.context import CryptContext

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

_pwd = CryptContext(schemes=["bcrypt"])


def main() -> int:
    if len(sys.argv) < 3:
        print("Uso: python scripts/create_admin.py <email> <senha> [nome]")
        return 1

    email = sys.argv[1].lower()
    senha = sys.argv[2]
    nome = sys.argv[3] if len(sys.argv) > 3 else None

    db_url = os.environ.get("DATABASE_URL_SYNC") or \
        os.environ.get("DATABASE_URL", "").replace("postgresql+asyncpg://", "postgresql://")
    if not db_url:
        print("ERRO: defina DATABASE_URL_SYNC ou DATABASE_URL", file=sys.stderr)
        return 1

    senha_hash = _pwd.hash(senha)

    with psycopg.connect(db_url) as conn, conn.cursor() as cur:
        cur.execute(
            "SELECT id FROM public.usuarios WHERE lower(email) = %s", (email,)
        )
        row = cur.fetchone()
        if row:
            print(f"Usuário {email} já existe (id={row[0]}). Atualizando senha...")
            cur.execute(
                "UPDATE public.usuarios SET senha_hash = %s, is_platform_admin = TRUE, nome = COALESCE(%s, nome) WHERE id = %s",
                (senha_hash, nome, row[0]),
            )
        else:
            cur.execute(
                """
                INSERT INTO public.usuarios (email, senha_hash, nome, is_platform_admin)
                VALUES (%s, %s, %s, TRUE)
                RETURNING id
                """,
                (email, senha_hash, nome),
            )
            uid = cur.fetchone()[0]
            print(f"✓ Admin criado: {email} (id={uid})")
        conn.commit()
    return 0


if __name__ == "__main__":
    sys.exit(main())
