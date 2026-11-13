# 도안IPARK파인공인중개사사무소 홈페이지

대전광역시 서구 **도안동** 매물만 보여주는 무료·무서버 정적 홈페이지입니다.
HTML/CSS/Vanilla JS + `data/properties.json` + GitHub Pages로 동작하며, 백엔드·DB·유료 SDK가 없습니다.

## 폴더 구조

```text
index.html                 공개 홈페이지
css/style.css
js/config.js               ★ 사무소 정보·지도·데이터 경로 설정
js/common.js               가격/면적 포맷, 도안동 경계 검증 (공개·관리자 공용)
js/boundary.js             도안동 행정동 경계 좌표 (자동 생성)
js/map.js                  지도 (OpenStreetMap + Leaflet, API 키 불필요)
js/app.js                  필터·정렬·목록·상세·지도 동기화
data/properties.json       ★ 실제 게시 데이터 (관리자 화면에서 만들어 교체)
data/properties.sample.json  로컬 미리보기용 예시 매물 (배포 제외)
data/doan-dong-boundary.geojson  경계 원본 (출처 포함)
assets/properties/         매물 사진 (WebP 권장)
assets/placeholders/       사진이 없을 때 쓰는 기본 그림
admin/                     로컬 전용 관리자 화면 (배포 제외)
.github/workflows/pages.yml  공개 파일만 골라 GitHub Pages에 배포
```

## 로컬에서 미리보기

```bash
cd budongsan-homepage
python3 -m http.server 8000
```

- 홈페이지: http://localhost:8000 — 로컬에서는 **예시 매물**(`properties.sample.json`)이 보입니다.
- 관리자: http://localhost:8000/admin/

GitHub Pages(공개 사이트)에서는 예시 매물을 쓰지 않고 `data/properties.json`의 **공개(published)** 매물만 보여줍니다. 기본 `properties.json`에는 숨김 처리된 예시 1건만 있으므로, 첫 게시 전에는 공개 사이트가 "매물 없음" 상태로 보입니다.

## 처음 한 번만: 설치 및 배포 설정

1. **GitHub 계정**을 만들고 [GitHub Desktop](https://desktop.github.com/)을 설치해 로그인합니다.
2. GitHub Desktop → `File > Add local repository` → 이 폴더 선택 → "create a repository" → **Publish repository** (Public 체크 해제 여부: GitHub Pages 무료 사용은 공개 저장소 기준).
3. github.com에서 저장소 → **Settings → Pages → Build and deployment → Source: GitHub Actions** 선택.
4. 잠시 후 **Actions** 탭에서 배포가 끝나면 `https://<아이디>.github.io/<저장소명>/` 주소가 생깁니다.

> 배포 워크플로가 `index.html, css, js, data, assets`만 복사하므로 `admin/`, PRD, 카카오톡 원본 자료는 공개 사이트에 올라가지 않습니다.
> 단, **공개 저장소의 파일 자체는 누구나 볼 수 있습니다.** 고객 개인정보·비밀 키는 절대 저장소에 넣지 마세요. (`.gitignore`가 `KakaoTalk_*` 파일을 제외합니다.)

## 매물 등록·수정 (매번)

1. GitHub Desktop에서 **Fetch origin / Pull** 로 최신 상태 받기.
2. 관리자 화면 열기: 위 로컬 서버로 `http://localhost:8000/admin/` (또는 `admin/index.html` 파일을 더블클릭).
3. **[저장소 파일 읽기]** (로컬 서버일 때) 또는 **[properties.json 불러오기]** 로 `data/properties.json` 열기.
4. **+ 새 매물 / 수정 / 복제** → 지도를 클릭해 위치 지정 → **검증 후 저장**.
   - 도안동 경계 밖 좌표, 가격·면적 오류는 저장되지 않습니다.
   - 동·호수, 휴대전화 번호 등 개인정보로 보이는 내용은 경고가 뜹니다.
   - 상태: **공개**(홈페이지 표시) / **숨김** / **거래완료**(홈페이지에서 내려감).
5. 사진: **[사진 선택 → WebP 최적화 다운로드]** → 다운로드된 `DA-0001-1.webp` 같은 파일을 `assets/properties/` 폴더로 옮깁니다. (변환 과정에서 GPS 등 메타데이터가 제거됩니다)
6. **[게시용 JSON 다운로드]** → 받은 `properties.json`으로 저장소의 `data/properties.json`을 **교체**.
7. GitHub Desktop: 변경 파일 확인 → Summary에 "매물 업데이트" 입력 → **Commit to main** → **Push origin**.
8. 1~3분 뒤 홈페이지를 새로고침하면 반영됩니다. (데이터는 매번 캐시를 우회해 읽습니다)

삭제·거래완료·가격 변경도 같은 절차입니다. 작업 중 내용은 브라우저에 임시 저장되므로 창을 닫아도 복원됩니다.

## 지도 (OpenStreetMap)

지도는 **OpenStreetMap 타일 + Leaflet**을 사용합니다. 가입·API 키·요금이 없습니다. 네이버 지도 API는 사용하지 않습니다.

- 지도 오른쪽 아래의 `© OpenStreetMap contributors` 저작권 표시는 지우면 안 됩니다.
- OSM 공식 타일 서버는 기부로 운영됩니다. [타일 이용 정책](https://operations.osmfoundation.org/policies/tiles/)을 지켜 주세요. 방문자가 크게 늘면 무료 한도가 있는 다른 타일 서비스로 `js/map.js`의 타일 주소만 바꾸면 됩니다.
- 지도가 불러와지지 않아도 매물 목록과 전화 버튼은 계속 동작합니다.
- '오시는길'의 **네이버 지도에서 길찾기** 버튼은 단순 링크라 API·키와 무관합니다.

## 도안동 경계 데이터

- 대상: 대전광역시 서구 도안동 (행정동 코드 3017059300)
- 출처: 통계청 SGIS 행정동 경계(공공누리 제1유형), 가공 [vuski/admdongkor](https://github.com/vuski/admdongkor) `ver20261001` (CC BY 4.0), 2026-11-13 수집
- 행정구역 변경 시 위 저장소의 최신 GeoJSON에서 같은 코드를 추출해 `data/doan-dong-boundary.geojson`과 `js/boundary.js`를 교체하세요.
- 검증 규칙: 경계 사각형(보조) → 다각형 내부 판정(주). 경계 밖 좌표 매물은 지도·목록 모두에서 제외됩니다. 좌표가 없는 공개 매물은 목록에만 표시됩니다.

## 설정 (`js/config.js`)

| 항목 | 설명 |
|---|---|
| `office.*` | 상호·전화·주소. 화면 곳곳에 자동 반영 |
| `office.registrationNumber`, `representative` | **법정 표시정보** — 등록증 등 실제 증빙 확인 후 입력. 입력하면 푸터에 표시 |
| `map.provider` | `osm`(기본, OpenStreetMap) / `none`(지도 끔) |
| `data.demoMode` | `auto`면 localhost에서만 예시 매물 표시 |

## 데이터 형식 (`data/properties.json`)

```json
{
  "id": "DA-0001",
  "title": "도안IPARK 1단지",
  "transaction": "sale | jeonse | monthly",
  "propertyType": "apartment | officetel | house | commercial | land | etc",
  "priceKRW": 750000000,          // 매매가 (매매)
  "depositKRW": null,             // 보증금 (전세·월세)
  "monthlyRentKRW": null,         // 월세 (월세)
  "maintenanceFeeKRW": 230000,
  "areaM2": 59.9, "supplyAreaM2": 84.9,
  "floor": "15", "totalFloors": 25, "rooms": 3, "baths": 2,
  "moveInDate": "협의",
  "addressDong": "도안동",
  "latitude": 36.3139, "longitude": 127.3496,
  "highlights": ["도안호수공원 인접"],
  "description": "...",
  "images": ["assets/properties/DA-0001-1.webp"],
  "featured": true,               // 추천매물 (1건)
  "status": "published | hidden | sold",
  "updatedAt": "2026-11-12",
  "lastCheckedAt": "2026-11-12"   // 마지막 거래가능 확인일 (30일 경과 시 관리자 경고)
}
```

## 운영 체크리스트

- 공인중개사법상 중개대상물 표시·광고 의무사항(사무소 명칭·소재지·연락처·등록번호, 개업공인중개사 성명, 매물 소재지·면적·가격·종류·거래형태 등)을 확인하고 누락 항목은 필드를 추가하세요.
- 거래완료 매물은 즉시 `거래완료`로 바꿔 게시하세요 (허위·미끼 매물 방지).
- 정확한 동·호수, 임차인 정보, 사진 속 차량번호·얼굴은 공개하지 마세요.
- OpenStreetMap 저작권 표시와 타일 이용 정책을 준수하세요.
