import type { Tokens } from 'src/theme/tokens';

const FONT =
  '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", system-ui, sans-serif';

/** 흰 바탕, 파스텔 블록, 검정·라임 포인트. */
const light: Tokens = {
  bg: { base: '#FAFAF7', surface: '#FFFFFF', raised: '#FFFFFF' },
  text: { primary: '#18181B', secondary: '#52525B', muted: '#71717A' },
  border: '#E4E4E7',
  accent: { main: '#18181B', contrast: '#D9F99D', text: '#18181B', gradient: '#18181B' },
  label: {
    red: { fill: '#FFD6CC', text: '#8A2A14', marker: '#E8553A' },
    orange: { fill: '#FFE3C4', text: '#7A3E05', marker: '#F08A24' },
    yellow: { fill: '#FFF1B8', text: '#6B5200', marker: '#E9B800' },
    green: { fill: '#E7F5D0', text: '#35540F', marker: '#7CB518' },
    teal: { fill: '#CDF3EA', text: '#0E5A4C', marker: '#14B8A0' },
    blue: { fill: '#CFE8FF', text: '#134B7D', marker: '#3B9BEB' },
    purple: { fill: '#E4DAFF', text: '#4A2B9A', marker: '#8B6CF0' },
    pink: { fill: '#FFD9EA', text: '#8A1F57', marker: '#EC5BA0' },
  },
  radius: { sm: 8, md: 12, lg: 20, xl: 28 },
  shadow: {
    1: '0 1px 2px rgba(24, 24, 27, 0.06)',
    2: '0 8px 24px rgba(24, 24, 27, 0.1)',
  },
  font: { body: FONT, display: FONT },
};

/** 라임이 포인트가 되도록 검정·라임을 뒤집는다. */
const dark: Tokens = {
  bg: { base: '#111113', surface: '#1B1B1F', raised: '#26262B' },
  text: { primary: '#F4F4F5', secondary: '#B4B4BC', muted: '#8E8E98' },
  border: '#34343A',
  accent: { main: '#D9F99D', contrast: '#18181B', text: '#D9F99D', gradient: '#D9F99D' },
  label: {
    red: { fill: '#4A2520', text: '#FFB8A8', marker: '#FF7A5C' },
    orange: { fill: '#4A3018', text: '#FFCC9A', marker: '#FFA040' },
    yellow: { fill: '#463C14', text: '#FFE680', marker: '#F5CB2E' },
    green: { fill: '#2A3E18', text: '#C4E89A', marker: '#8FD14F' },
    teal: { fill: '#14403A', text: '#9CEBDC', marker: '#2DD4BC' },
    blue: { fill: '#173A5C', text: '#A9D6FF', marker: '#55AEFF' },
    purple: { fill: '#35295E', text: '#CDBFFF', marker: '#A68BFF' },
    pink: { fill: '#4B2038', text: '#FFB8DA', marker: '#FF6FB0' },
  },
  radius: { sm: 8, md: 12, lg: 20, xl: 28 },
  shadow: {
    1: '0 1px 2px rgba(0, 0, 0, 0.4)',
    2: '0 8px 24px rgba(0, 0, 0, 0.5)',
  },
  font: { body: FONT, display: FONT },
};

export const pastel = { light, dark };
