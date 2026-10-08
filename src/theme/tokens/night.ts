import type { Tokens } from 'src/theme/tokens';

const FONT =
  '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

/**
 * 깊은 남색, 반투명 유리 카드, 빛나는 라벨 색. 다이얼로그·메뉴에도 같은 표면 색을 쓰므로
 * 표면은 불투명 색으로 두고, 유리 느낌(`backdrop-filter`)은 컴포넌트에서 더한다.
 */
const dark: Tokens = {
  bg: { base: '#0E1324', surface: '#171E38', raised: '#212A4D' },
  text: { primary: '#E8ECF8', secondary: '#AAB3D0', muted: '#8C96B8' },
  border: '#2B3558',
  accent: {
    // 그라데이션 시작색(#7C5CFF)은 흰 글자와의 대비가 4.35라서, 단색으로 쓰는 main은 살짝 짙게 한다.
    main: '#7857FF',
    contrast: '#FFFFFF',
    // 어두운 바탕 위 글자·아웃라인 버튼용. main(#7857FF)은 표면 위 대비가 3.6이라 더 밝은 보라를 쓴다.
    text: '#A693FF',
    gradient: 'linear-gradient(135deg, #7C5CFF, #3FB6FF)',
  },
  label: {
    red: { fill: '#3A1F30', text: '#FF9C9C', marker: '#FF6B6B' },
    orange: { fill: '#3A2C2C', text: '#FFC870', marker: '#FFB547' },
    yellow: { fill: '#38342C', text: '#FFE27A', marker: '#FFD23F' },
    green: { fill: '#1D3A3C', text: '#9BF0B8', marker: '#4BE08A' },
    teal: { fill: '#153A4A', text: '#8BEAF0', marker: '#2DD4D4' },
    blue: { fill: '#172F5C', text: '#7FD0FF', marker: '#3FB6FF' },
    purple: { fill: '#2D2559', text: '#C9A6FF', marker: '#B07CFF' },
    pink: { fill: '#3D2156', text: '#FFA8E0', marker: '#FF6FC8' },
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24 },
  shadow: {
    1: '0 1px 0 rgba(255, 255, 255, 0.05) inset',
    2: '0 12px 32px rgba(3, 6, 20, 0.55)',
  },
  font: { body: FONT, display: FONT },
};

/** 밝은 야외에서 읽기 쉽도록 라벤더 빛이 도는 밝은 바탕. 포인트는 같은 보라→하늘. */
const light: Tokens = {
  bg: { base: '#F2F4FB', surface: '#FFFFFF', raised: '#FFFFFF' },
  text: { primary: '#151B33', secondary: '#4A5373', muted: '#7480A0' },
  border: '#DDE2F0',
  accent: {
    main: '#6A4BF0',
    contrast: '#FFFFFF',
    text: '#6A4BF0',
    gradient: 'linear-gradient(135deg, #6A4BF0, #2F9BE0)',
  },
  label: {
    red: { fill: '#FFE0E3', text: '#9B1F2E', marker: '#E64555' },
    orange: { fill: '#FFE8CF', text: '#8A4300', marker: '#F08A1F' },
    yellow: { fill: '#FFF3C2', text: '#6B5200', marker: '#E8B800' },
    green: { fill: '#D8F5E3', text: '#145C34', marker: '#22B864' },
    teal: { fill: '#CFF3F4', text: '#0D5560', marker: '#12B5C4' },
    blue: { fill: '#D6EAFF', text: '#0F4A80', marker: '#2E9BF0' },
    purple: { fill: '#E6DCFF', text: '#4B2BA0', marker: '#8B5CF6' },
    pink: { fill: '#FFDDF2', text: '#8A1F6A', marker: '#E64DB3' },
  },
  radius: { sm: 8, md: 12, lg: 16, xl: 24 },
  shadow: {
    1: '0 1px 2px rgba(21, 27, 51, 0.06)',
    2: '0 10px 28px rgba(60, 50, 140, 0.14)',
  },
  font: { body: FONT, display: FONT },
};

export const night = { light, dark };
