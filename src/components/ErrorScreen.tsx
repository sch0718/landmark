import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

type Props = {
  title: string;
  details?: string[];
};

/** 여행을 열 수 없을 때의 전체 화면 안내(§6). */
export function ErrorScreen({ title, details = [] }: Props) {
  return (
    <Box
      role="alert"
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 1,
        p: 3,
        textAlign: 'center',
      }}
    >
      <Typography variant="h6" component="h1">
        {title}
      </Typography>
      {details.map((line) => (
        <Typography
          key={line}
          variant="body2"
          color="text.secondary"
          sx={{ wordBreak: 'break-all' }}
        >
          {line}
        </Typography>
      ))}
    </Box>
  );
}
