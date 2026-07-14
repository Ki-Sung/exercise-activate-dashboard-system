# EAD(Exercise Activate Dashboard) System

AWS 없이, 카드 등록 없이, 개인 프로젝트 규모에서 **월 0원**으로 굴러가는 구성입니다.

---

## 1. 아키텍처

```
 ┌──────────────────┐   09/12/18/22 KST (cron)
 │  GitHub Actions  │──────────────────────────┐
 │  (배치 = 서버)    │  Exponential Backoff     │
 └──────────────────┘  + Jitter, 최대 7회 재시도 │
          │                                     ▼
          │  garminconnect (토큰 로그인)   ┌──────────────┐
          └──────────────────────────────▶│ Garmin Connect│
          │                                └──────────────┘
          ▼  upsert (service_role)
 ┌──────────────────────────────┐
 │  Supabase (Postgres)         │  activities / daily_stats
 │  RLS 전면 차단               │  sync_runs / app_secrets(토큰)
 │  집계 뷰: 일 / 주 / 월        │
 └──────────────────────────────┘
          ▲ service_role (서버 사이드에서만)
          │
 ┌──────────────────────────────┐
 │  FastAPI (Vercel Python Fn)  │  /api/py/summary/{daily,weekly,monthly}
 │  X-API-Key 인증, 읽기 전용    │  /api/py/activities
 └──────────────────────────────┘
          ▲                    ▲
          │                    │  X-API-Key (SecureStore 보관)
 ┌────────────────┐   ┌────────────────────┐
 │ Next.js (웹)   │   │ Expo (모바일 앱)    │
 │ Vercel · 무료  │   │ Expo Go / EAS 무료  │
 └────────────────┘   └────────────────────┘
```

### 왜 이 조합인가 (무료 한도)

| 역할 | 선택 | 무료 한도 | 비고 |
|---|---|---|---|
| DB | **Supabase** | Postgres 500MB, 2개 프로젝트 | 러닝 데이터는 연 1MB 미만. 넘칠 일 없음 |
| 배치 스케줄러 | **GitHub Actions** | Public 무제한 / Private 월 2,000분 | 4회 × 30일 × 약 1분 ≈ **월 120분** |
| API 서버 | **Vercel (Python Functions)** | Hobby 무료 | Render 무료는 15분 후 슬립 → 콜드스타트 50초. Vercel 이 유리 |
| 웹 | **Vercel (Next.js)** | Hobby 무료 | API 와 **같은 프로젝트** → CORS 문제 없음 |
| 모바일 | **Expo** | Expo Go 무료, EAS 빌드 월 30회 | 스토어 등록 없이 폰에서 바로 사용 가능 |

> **주의 (무료 티어의 함정 2가지)**
> 1. Supabase 무료 프로젝트는 **7일간 아무 요청도 없으면 일시정지**됩니다 → 하루 4번 배치가 도니 자동 방지됨.
> 2. GitHub Actions 의 스케줄 워크플로는 **레포에 60일간 커밋이 없으면 자동 비활성화**됩니다 → 두 달에 한 번 커밋하거나, 워크플로에 keepalive 스텝을 넣으세요.

---

## 2. 구축 순서 (약 40분)

### Step 1 — Supabase
1. supabase.com 가입 → New Project (Region: **Northeast Asia (Seoul)**)
2. SQL Editor 에 `db/schema.sql` 전체 붙여넣고 실행
3. Settings → **Data API** → **Exposed schemas** 에 `garmin` 추가 (`public, garmin`) 후 Save
4. Settings → API 에서 두 값 복사
   - `Project URL` → `SUPABASE_URL`
   - `service_role` secret → `SUPABASE_SERVICE_ROLE_KEY` ← **절대 프론트에 넣지 말 것**

### Step 2 — 가민 토큰 발급 (로컬 1회)
CI 에는 사람이 없으므로 MFA 프롬프트가 뜨면 배치가 죽습니다. 그래서 로컬에서 한 번만 로그인해 토큰을 만들어 둡니다.

```bash
pip install -r batch/requirements.txt
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
python -m batch.bootstrap_token      # 이메일/비번/MFA 6자리 입력
```
- 토큰이 Supabase `garmin.app_secrets` 에 저장되고, 백업용 base64 가 출력됩니다.
- **DI OAuth 토큰은 실행 중 자동 갱신**됩니다. 갱신본은 배치가 DB에 다시 저장합니다.
- 토큰이 더 이상 유효하지 않으면 이 명령을 다시 1회 실행하면 됩니다.

### Step 3 — GitHub Actions
레포 Settings → Secrets and variables → Actions 에 등록:

| Secret | 값 |
|---|---|
| `SUPABASE_URL` | Step 1 |
| `SUPABASE_SERVICE_ROLE_KEY` | Step 1 |
| `GARMIN_TOKEN_B64` | Step 2 출력값 (DB 토큰이 날아갔을 때의 백업) |

첫 백필은 수동으로:
Actions 탭 → `garmin-sync` → **Run workflow** → days = `365`

### Step 4 — Vercel (API + 웹, 한 프로젝트)
1. vercel.com 에 이 레포를 Import (Framework: Next.js, 자동 인식)
2. Environment Variables:
   ```
   SUPABASE_URL                 = ...
   SUPABASE_SERVICE_ROLE_KEY    = ...
   DASHBOARD_API_KEY            = openssl rand -hex 32 로 생성
   ALLOWED_ORIGINS              = https://<프로젝트>.vercel.app
   INTERNAL_API_BASE            = https://<프로젝트>.vercel.app/api/py
   DASHBOARD_API_KEY_SERVER     = DASHBOARD_API_KEY 와 동일한 값
   ```
3. Deploy. `vercel.json` 의 rewrite 가 `/api/py/*` 를 FastAPI 로 보냅니다.

### Step 5 — 모바일
```bash
npx create-expo-app@latest mobile --template blank-typescript
cd mobile && npx expo install expo-secure-store
# App.tsx 를 이 레포의 mobile/App.tsx 로 교체, API_BASE 수정
npx expo start        # 폰에서 Expo Go 로 QR 스캔 → 끝
```
스토어 배포 없이 계속 쓸 거면 여기서 멈춰도 됩니다.
**더 빠른 대안**: 웹이 이미 PWA 매니페스트를 갖고 있으니, 사파리/크롬에서 "홈 화면에 추가"만 해도 앱처럼 동작합니다.

---

## 3. 재시도 전략 (`batch/retry_policy.py`)

```
sleep(n) = capped/2 + random(0, capped/2)
capped   = min(2 × 2^(n-1), 120)
```

| 시도 | 기본 대기 | 실제 대기(Equal Jitter) |
|---|---|---|
| 1→2 | 2s | 1 ~ 2s |
| 2→3 | 4s | 2 ~ 4s |
| 3→4 | 8s | 4 ~ 8s |
| 4→5 | 16s | 8 ~ 16s |
| 5→6 | 32s | 16 ~ 32s |
| 6→7 | 64s | 32 ~ 64s |

최대 7회 시도, 최악의 경우 누적 대기 약 2분.

- **재시도 대상**: 커넥션 오류 / 타임아웃 / 429 / 5xx
- **재시도 안 함**: `GarminConnectAuthenticationError` (401/403)
  → 토큰이 죽은 것이므로 재시도해봐야 무의미. 즉시 실패시켜 알림받는 게 맞습니다.
- 모든 시도 횟수는 `garmin.sync_runs.attempts` 에 기록되어 사후 분석이 가능합니다.

---

## 4. 보안 설계

| 항목 | 처리 |
|---|---|
| 가민 계정 비밀번호 | **어디에도 저장하지 않음.** 로컬 부트스트랩 때만 메모리에 존재 (`getpass`) |
| 가민 토큰 | Supabase `app_secrets` (RLS 로 service_role 만 접근) + GitHub Secret 백업 |
| `service_role` 키 | GitHub Actions 시크릿 + Vercel 서버 런타임에만 존재. **클라이언트 번들 유입 0** |
| DB 접근 | 전 테이블 RLS ON + 정책 없음 → anon 키로는 한 줄도 못 읽음 |
| API 인증 | `X-API-Key` + `hmac.compare_digest` (타이밍 공격 방어) |
| API 노출면 | GET only, `docs_url=None` (Swagger 비공개), CORS 화이트리스트 |
| 웹 | 서버 컴포넌트에서만 API 호출 → API 키가 브라우저에 노출되지 않음 |
| 모바일 | API 키를 번들에 하드코딩하지 않고 `expo-secure-store`(Keychain/Keystore)에 보관 |

> 다중 사용자로 확장할 땐 `require_api_key` 를 Supabase Auth JWT 검증으로 바꾸고,
> 테이블에 `user_id` 를 추가한 뒤 RLS 정책 `auth.uid() = user_id` 를 켜면 됩니다.

---

## 5. 작성하신 코드에서 바꾼 부분

| 원본 | 문제 | 이 레포에서의 처리 |
|---|---|---|
| `client = Garmin(token_dir)` | 첫 인자는 `email` 자리 — 토큰 로그인은 `Garmin()` 후 `login(tokenstore=...)` | `garmin_client.py` 에서 분리 |
| `prompt_mfa=get_mfa` | CI 에서 `input()` 은 무조건 실패 | 로컬 부트스트랩 1회 → 토큰 기반 무인 로그인 |
| `get_activities(0, 10)` | 최근 10건 고정. 하루 3번 뛰면 3일치도 못 채움 | `get_activities_by_date(from, to)` 14일 롤링 윈도우 |
| `activities[0]` / `activities[1]` 혼용 | 인덱스가 섞여 다른 활동의 값을 읽음 | 전 활동 순회 + `activity_id` PK upsert (멱등) |
| `distance_km > 0` 만 방어 | `duration`, `maxHR` 등이 `None` 이면 `int(None)` 폭발 | `transform.py` 에서 전 필드 안전 캐스팅 |
| 페이스 = 개별 활동 평균 | 주/월 집계 시 **페이스의 평균**은 왜곡됨 (인터벌 1km + LSD 20km 를 단순평균) | 뷰에서 `총시간 ÷ 총거리` 로 가중 계산 |
| 토큰 디렉토리 로컬 저장 | Actions 는 매 실행마다 파일시스템이 초기화됨 | 갱신 토큰을 DB 에 되돌려 저장 |

---

## 6. 로컬 실행

```bash
# 배치
pip install -r batch/requirements.txt
export SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
python -m batch.main --days 30

# API + 웹
npm install
npm run dev          # http://localhost:3000
```
