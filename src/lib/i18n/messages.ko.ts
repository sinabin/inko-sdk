// 한국어 UI 문자열 — i18n 기본(fallback) 언어.
// 키는 dot-namespaced. 동적 문자열은 {param} 자리표시자 사용.
export const ko: Record<string, string> = {
  // 도구
  'tool.select': '선택',
  'tool.pen': '펜',
  'tool.highlighter': '형광펜',
  'tool.eraser': '지우개',
  'tool.rectangle': '사각형',
  'tool.circle': '원',
  'tool.line': '선',
  'tool.text': '텍스트',

  // 툴바
  'toolbar.thumbnailsHide': '썸네일 숨기기',
  'toolbar.thumbnailsShow': '썸네일 표시',
  'toolbar.prevPage': '이전 페이지',
  'toolbar.nextPage': '다음 페이지',
  'toolbar.currentPage': '현재 페이지',
  'toolbar.undo': '실행 취소',
  'toolbar.redo': '다시 실행',
  'toolbar.zoomOut': '축소',
  'toolbar.zoomIn': '확대',
  'toolbar.orientationLandscape': '가로 보기',
  'toolbar.orientationPortrait': '세로 보기',
  'toolbar.deleteSelection': '선택 삭제',
  'toolbar.bookmarksShow': '책갈피 표시',
  'toolbar.bookmarksHide': '책갈피 숨기기',

  'toolbar.history': '작업 이력',
  'toolbar.save': '저장',

  // 책갈피(PDF 내장 목차) 패널
  'bookmark.title': '책갈피',
  'bookmark.loading': '목차를 불러오는 중...',
  'bookmark.outlineEmpty': '이 PDF에는 목차 정보가 없습니다.',
  'bookmark.untitled': '제목 없음',
  'bookmark.pageLabel': '{n}페이지',
  'bookmark.goToPage': '{title} — {page}로 이동',
  'bookmark.unresolved': '{title} — 이동할 위치를 찾을 수 없음',
  'bookmark.externalUnsupported': '{title} — 외부 링크는 뷰어에서 열지 않음',
  'bookmark.expand': '{title} 하위 항목 펼치기',
  'bookmark.collapse': '{title} 하위 항목 접기',
  'bookmark.close': '책갈피 패널 닫기',

  // 작업 이력 패널
  'history.title': '작업 이력',
  'history.empty': '작업 이력이 없습니다.',
  'history.continueEdit': '이어서 편집',
  'history.unknownUser': '알 수 없음',
  'history.hideUser': '{name} 숨기기',
  'history.showUser': '{name} 보이기',

  // 공통
  'common.cancel': '취소',
  'common.confirm': '확인',
  'common.closeNotification': '알림 닫기',

  // 도구 옵션 시트
  'sheet.color': '색상',
  'sheet.thickness': '굵기',
  'sheet.lineThickness': '선 굵기',
  'sheet.size': '크기',
  'sheet.pressure': '필압 감도',
  'sheet.customColor': '커스텀 색상',
  'sheet.customColorPick': '커스텀 색상 선택',
  'sheet.dialogLabel': '{header} 설정',
  'sheet.colorSwatch': '색상 {color}',
  'sheet.widthSwatch': '{label} {n}px',
  'sheet.textPreviewSample': '가나다 ABC',

  // 텍스트 입력
  'text.placeholder': '텍스트 입력...',

  // 토스트 카테고리
  'error.categoryParse': '데이터',
  'error.categoryRender': '렌더링',
  'error.categoryStorage': '저장소',
  'error.categoryBridge': '연결',
  'error.categoryTool': '도구',
  'error.categoryNetwork': '네트워크',
  'error.categoryUnknown': '시스템',

  // 뷰어 상태·알림 (PdfViewer)
  'viewer.tapToPlaceText': '캔버스를 탭하여 텍스트를 배치하세요',
  'viewer.savedVersion': '저장되었습니다 (버전 {version})',
  'viewer.saveRequested': '저장 요청을 전송했습니다',
  'viewer.saveDataError': '저장할 데이터를 만드는 중 오류가 발생했습니다',
  'viewer.saveFailed': '로컬 저장에 실패했습니다',
  'viewer.encodeFailed': '저장 데이터 인코딩 실패',

  // 썸네일
  'thumbnails.noPdf': '불러온 PDF가 없습니다',
  'thumbnails.loadingList': '썸네일 로딩 중... ({n}/{total})',
  'thumbnail.loading': '로딩 중...',
  'thumbnail.error': '오류',
  'thumbnail.pageLabel': '{n}페이지',
  'thumbnail.contextError': '2D 컨텍스트 생성 실패',
}
