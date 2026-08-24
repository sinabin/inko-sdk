# Inko visual review checklist

`Visual Review Capture` workflow의 성공은 고정 Linux Chromium 환경에서 검토용
PNG를 생성했다는 뜻입니다. 미감·사용성 승인이나 릴리스 승인을 자동으로
의미하지 않습니다.

## 검토 기록

- Commit SHA:
- Workflow run URL:
- Artifact digest:
- Reviewer:
- Reviewed at (KST):
- Decision: Approved / Changes requested

## 사람이 확인할 항목

- [ ] `01-viewer-initial.png`에서 툴바·사이드바·PDF 본문이 잘리거나 겹치지 않는다.
- [ ] 한글 라벨·아이콘·페이지 표시의 정렬과 대비가 자연스럽다.
- [ ] `02-pen-stroke.png`의 펜 선이 포인터 경로를 따라 끊김 없이 표시된다.
- [ ] `03-highlighter-stroke.png`의 투명도와 겹침이 원문을 읽을 수 있는 수준이다.
- [ ] 도구 옵션 sheet와 canvas가 예기치 않게 서로 가리거나 viewport 밖으로 나가지 않는다.
- [ ] 이전 승인 캡처와 비교해 의도하지 않은 색·간격·폰트·레이아웃 변화가 없다.
- [ ] 발견한 차이와 승인 또는 수정 요청 근거를 릴리스 검토 기록에 남겼다.

완료한 체크리스트는 해당 릴리스 PR 또는 내부 릴리스 승인 기록에 첨부합니다.
