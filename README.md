# EAD(Exercise Activate Dashboard) System

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

웹(Next.js)과 API(FastAPI)를 **같은 Vercel 프로젝트**로 배포합니다.  
`vercel.json` rewrite 가 `/api/py/*` → `/api/index` 로 연결합니다.

API 실제 로직은 리포지토리 루트의 `backend/` 패키지에 계층별로 분리되어 있고,
`api/index.py` 는 Vercel 이 요구하는 위치에 두는 **최소한의 진입점(스위치)** 역할만 합니다.

```
backend/
  routers/    # URL, 쿼리 파라미터, 인증 연결
  services/   # 비즈니스 로직 (포맷팅, 조회 조합)
  db/         # Supabase(PostgREST) 접근
  schemas/    # 응답 Pydantic 모델
  core/
    config.py       # 설정
    security.py      # X-API-Key 인증
    app_factory.py    # create_app() — FastAPI 앱을 만드는 팩토리
api/index.py  # Vercel 엔트리포인트 (backend.core.app_factory.create_app() 호출만 함)
```

> ⚠️ 왜 로직을 `api/` 안에 두지 않았나요? Vercel 의 Python 런타임은 두 가지 방식이 있는데,
> ① `/api` 안의 파일이 파일 경로 그대로 라우팅되는 **레거시 방식** (지금 이 프로젝트가 쓰는 방식,
> `api/index.py` → `/api/index`, `vercel.json` rewrites 로 연결) 과 ② `pyproject.toml` 로 커스텀
> 경로를 지정하는 **최신 방식**(앱 전체가 하나의 Function이 되며, Next.js 와 같은 프로젝트에서
> 쓰려면 별도의 "Services" 설정이 필요)이 있습니다. 이미 ①로 안정적으로 배포되고 있으므로,
> 로직 코드는 `backend/`(어떤 이름이든 `/api` 밖이면 무관)에 두고 `api/index.py` 는 건드리지 않는
> 것이 가장 안전합니다.

엔드포인트를 늘릴 땐 `backend/routers/`에 라우터 파일 하나, `backend/services/`에 로직 함수를 추가하고
`backend/core/app_factory.py` 에서 `include_router` 하면 됩니다. `api/index.py` 는 건드릴 필요가 없습니다.

#### 4-1. 프로젝트 Import
1. [vercel.com](https://vercel.com) → GitHub 로 로그인
2. **Add New… → Project** → 이 레포 Import
3. Framework: **Next.js** (자동)
4. **Project Name** 기본값이면 URL 은  
   `https://exercise-activate-dashboard-system.vercel.app`  
   (원하면 다른 이름도 가능. 단 `eads.vercel.app` 처럼 **이미 선점된 이름은 남의 사이트**가 됨)
5. Root Directory / Build 설정은 기본값 유지

#### 4-2. Environment Variables
Import 화면 또는 **Project → Settings → Environment Variables** 에 등록합니다.  
적용 환경은 **Production / Preview / Development 전부** 체크.

| Key | Value | 비고 |
|---|---|---|
| `SUPABASE_URL` | Step 1 Project URL | |
| `SUPABASE_SERVICE_ROLE_KEY` | Step 1 `service_role` | 절대 프론트에 노출 금지 |
| `DASHBOARD_API_KEY` | `openssl rand -hex 32` | |
| `DASHBOARD_API_KEY_SERVER` | **위와 동일한 값** | 서버 컴포넌트용. 비우면 데이터 안 보임 |
| `NEXT_PUBLIC_API_BASE` | `/api/py` | |
| `ALLOWED_ORIGINS` | `https://exercise-activate-dashboard-system.vercel.app,http://localhost:3000` | Production URL 에 맞게 |
| `INTERNAL_API_BASE` | `https://exercise-activate-dashboard-system.vercel.app/api/py` | Production URL 에 맞게 |

> `GARMIN_TOKEN_B64` 는 Vercel 에 넣지 않습니다. (배치 / GitHub Actions 전용)

도메인을 아직 안 정했다면 임시로 `localhost` 만 넣고 Deploy 한 뒤,  
실제 `*.vercel.app` URL 로 두 값을 수정하고 **Redeploy** 해도 됩니다.

커스텀 도메인(예: `eads-app.com`)은 **구매·DNS 연결 후**에만 넣으세요.  
연결 전에 `INTERNAL_API_BASE` 를 `.com` 으로 두면 대시보드가 API 를 못 부릅니다.

```text
# 커스텀 도메인 연결 후 예시
ALLOWED_ORIGINS=https://eads-app.com,http://localhost:3000
INTERNAL_API_BASE=https://eads-app.com/api/py
```

환경변수만 바꾼 뒤에는 **Deployments → ⋯ → Redeploy** 해야 반영됩니다.

#### 4-3. Deploy & 확인
1. **Deploy** → 상태가 **Ready** 인지 확인
2. `https://exercise-activate-dashboard-system.vercel.app` 접속
3. API 스모크 테스트:
   ```bash
   curl -s -H "X-API-Key: <DASHBOARD_API_KEY>" \
     https://exercise-activate-dashboard-system.vercel.app/api/py/activities?limit=3
   ```
   - JSON / 데이터 배열 → API OK  
   - `[]` → API는 되나 DB에 활동 없음  
   - `401` → 키 불일치  
   - 화면만 뜨고 숫자 0 → `INTERNAL_API_BASE` / `DASHBOARD_API_KEY_SERVER` 확인 후 Redeploy

#### 4-4. 이후 커밋하면?
GitHub 레포와 Vercel 이 연결되어 있으면, **Production 브랜치(`main` 등)에 push 할 때마다 자동으로 다시 빌드·배포**됩니다.  
수동으로 “다시 빌드 버튼”을 누를 필요는 없습니다.

- 코드/`package.json` 변경 → push → 자동 Deploy  
- **Env 변수만** 변경 → push 없음 → **Redeploy** 한 번 필요  
- Preview: PR / 다른 브랜치 push 시 Preview URL 로 별도 배포

#### 4-5. 자주 막히는 점
| 증상 | 확인 |
|---|---|
| `Module not found: './lib/api'` | `app/lib/api.ts` 가 Git 에 포함됐는지. `.gitignore` 의 `lib/` 가 `app/lib` 까지 가리지 않아야 함 (`/lib/` 권장) |
| Build Error 로그가 잘림 | Build Logs **맨 아래** 까지 스크롤 (`Failed to compile` / `exited with 1`) |
| Next deprecation warn | 경고일 뿐. 보안 패치 버전으로 올리는 것은 권장 |

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
| API 노출면 | GET only, Swagger `/api/py/docs` (개인용), CORS 화이트리스트 |
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
