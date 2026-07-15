"""
★ 로컬 PC 에서 딱 한 번만 실행하는 스크립트.

하는 일:
1. 이메일/비밀번호 + MFA 로 가민에 로그인
2. 발급된 토큰(oauth1/oauth2)을 Supabase 에 저장
3. 백업용 base64 를 화면에 출력 → GitHub Secrets 의 GARMIN_TOKEN_B64 에 넣어둔다

이후 GitHub Actions 는 사람 개입 없이 이 토큰으로만 동작한다.
토큰이 만료되면 이 스크립트를 다시 1회 실행하면 된다.

실행:
    export SUPABASE_URL=...
    export SUPABASE_SERVICE_ROLE_KEY=...
    python -m batch.bootstrap_token
"""
from __future__ import annotations

import getpass
import tempfile
from pathlib import Path

from garminconnect import Garmin

from batch.config import Settings
from batch.garmin_client import encode_token_b64, read_token_dir
from batch.repository import SupabaseRepository


def main() -> None:
    settings = Settings.load()

    email = input("가민 이메일: ").strip()
    password = getpass.getpass("가민 비밀번호(화면에 표시되지 않음): ")

    token_dir = Path(tempfile.mkdtemp(prefix="garmin_bootstrap_"))

    client = Garmin(
        email=email,
        password=password,
        prompt_mfa=lambda: input("이메일/문자로 받은 6자리 MFA 코드: ").strip(),
    )
    client.login(str(token_dir))
    print("\n로그인 성공. 토큰을 발급했습니다.")

    tokens = read_token_dir(token_dir)

    with SupabaseRepository(settings.supabase_url, settings.supabase_service_key) as repo:
        repo.save_tokens(tokens)
    print("Supabase(garmin.app_secrets)에 토큰을 저장했습니다.")

    print("\n=== GitHub Secrets > GARMIN_TOKEN_B64 에 아래 값을 붙여넣으세요 (백업용) ===\n")
    print(encode_token_b64(tokens))
    print("\n=== 여기까지 ===")
    print(f"\n임시 토큰 디렉토리는 삭제하세요: {token_dir}")


if __name__ == "__main__":
    main()
