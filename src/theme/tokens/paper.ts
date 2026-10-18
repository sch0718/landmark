import type { Tokens } from 'src/theme/tokens';

const BODY =
  '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';
/** 제목용. 고운바탕은 수첩 테마를 고를 때만 불러오고, 그 전에는 시스템 명조가 대신한다. */
const DISPLAY = '"Gowun Batang", "Nanum Myeongjo", AppleMyungjo, Georgia, serif';

/** 종이색 바탕, 벽돌·숲·바다색 잉크, 도장 같은 라벨. */
const light: Tokens = {
  bg: { base: '#F6F1E7', surface: '#FFFDF8', raised: '#FFFFFF' },
  text: { primary: '#2B2620', secondary: '#5E5446', muted: '#766C60' },
  border: '#E8DFCF',
  borderStrong: '#A2906E',
  error: '#D32F2F',
  accent: { main: '#C2492D', contrast: '#FFFFFF', text: '#B4401F', gradient: '#C2492D' },
  label: {
    red: { fill: '#F6DDD3', text: '#A63A20', marker: '#C2492D' },
    orange: { fill: '#F5E1C8', text: '#8A4A12', marker: '#C9731F' },
    yellow: { fill: '#F3E8BE', text: '#6E5712', marker: '#B8921A' },
    green: { fill: '#DCE7D6', text: '#2F5A3F', marker: '#3E6B4E' },
    teal: { fill: '#D2E6E0', text: '#1F5C55', marker: '#2E7D74' },
    blue: { fill: '#D6E2EE', text: '#264F78', marker: '#2F5D8A' },
    purple: { fill: '#E3DCEB', text: '#55397A', marker: '#6E4F9A' },
    pink: { fill: '#F2D9DF', text: '#8E2F4E', marker: '#B8466A' },
  },
  radius: { sm: 6, md: 10, lg: 14, xl: 20 },
  shadow: {
    1: '0 1px 0 rgba(43, 38, 32, 0.08)',
    2: '0 1px 0 rgba(43, 38, 32, 0.08), 0 6px 16px rgba(43, 38, 32, 0.06)',
  },
  font: { body: BODY, display: DISPLAY },
};

/** 같은 종이를 등불 아래에 둔 느낌: 따뜻한 갈색 바탕. */
const dark: Tokens = {
  bg: { base: '#1B1713', surface: '#252019', raised: '#2F2921' },
  text: { primary: '#EFE6D6', secondary: '#C2B6A2', muted: '#9B907E' },
  border: '#3A3329',
  borderStrong: '#82735C',
  error: '#FF7A70',
  accent: { main: '#E8795B', contrast: '#1B1713', text: '#E8795B', gradient: '#E8795B' },
  label: {
    red: { fill: '#43251C', text: '#F4B09B', marker: '#E2684A' },
    orange: { fill: '#432E18', text: '#EFC08A', marker: '#DB8A3A' },
    yellow: { fill: '#403818', text: '#E8D68A', marker: '#D4B03A' },
    green: { fill: '#26361F', text: '#B5D3A4', marker: '#6FA06A' },
    teal: { fill: '#1B3732', text: '#9ED2C8', marker: '#4AA396' },
    blue: { fill: '#1E3248', text: '#A8C8E8', marker: '#5B91C7' },
    purple: { fill: '#2F2744', text: '#C9B8E6', marker: '#9376C4' },
    pink: { fill: '#43222E', text: '#EDB0C2', marker: '#D2688A' },
  },
  radius: { sm: 6, md: 10, lg: 14, xl: 20 },
  shadow: {
    1: '0 1px 0 rgba(0, 0, 0, 0.4)',
    2: '0 1px 0 rgba(0, 0, 0, 0.4), 0 6px 16px rgba(0, 0, 0, 0.35)',
  },
  font: { body: BODY, display: DISPLAY },
};

export const paper = { light, dark };
