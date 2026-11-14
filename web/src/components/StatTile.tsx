import { Card, CardContent, Stack, Typography } from '@mui/material';

export function StatTile({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <Card>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Typography variant="body2" color="text.secondary">
          {label}
        </Typography>
        <Typography variant="h5" sx={{ color: color ?? 'text.primary' }}>
          {value}
        </Typography>
        {sub && (
          <Typography variant="caption" color="text.secondary">
            {sub}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function StatTileGrid({ children }: { children: React.ReactNode }) {
  return (
    <Stack
      direction="row"
      flexWrap="wrap"
      gap={1.5}
      sx={{ '& > *': { flexGrow: 1, flexBasis: { xs: 'calc(50% - 6px)', sm: '160px' } } }}
    >
      {children}
    </Stack>
  );
}
