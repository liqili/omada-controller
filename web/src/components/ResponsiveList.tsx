import { type ReactNode } from 'react';
import {
  Box,
  Card,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';

export interface Column<T> {
  header: string;
  render: (row: T) => ReactNode;
  /** Column hidden below the `sm` breakpoint in card layout fallback. */
  hideOnMobile?: boolean;
}

/**
 * Renders a table on desktop and stacked cards on phones so the same data
 * works on every screen size.
 */
export function ResponsiveList<T>({
  rows,
  columns,
  keyOf,
  onClickRow,
  emptyText = 'No data',
}: {
  rows: T[];
  columns: Column<T>[];
  keyOf: (row: T) => string;
  onClickRow?: (row: T) => void;
  emptyText?: string;
}) {
  const theme = useTheme();
  const mobile = useMediaQuery(theme.breakpoints.down('sm'));

  if (!rows.length) {
    return (
      <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
        {emptyText}
      </Typography>
    );
  }

  if (!mobile) {
    return (
      <TableContainer component={Card}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {columns.map((c) => (
                <TableCell key={c.header}>{c.header}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((row) => (
              <TableRow
                key={keyOf(row)}
                hover
                onClick={onClickRow ? () => onClickRow(row) : undefined}
                sx={{ cursor: onClickRow ? 'pointer' : 'default' }}
              >
                {columns.map((c) => (
                  <TableCell key={c.header}>{c.render(row)}</TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    );
  }

  return (
    <Stack spacing={1}>
      {rows.map((row) => {
        const visible = columns.filter((c) => !c.hideOnMobile);
        const [first, ...rest] = visible;
        return (
          <Card
            key={keyOf(row)}
            onClick={onClickRow ? () => onClickRow(row) : undefined}
            sx={{ p: 1.5, cursor: onClickRow ? 'pointer' : 'default' }}
          >
            <Typography variant="subtitle2">{first ? first.render(row) : keyOf(row)}</Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                gap: 0.5,
                mt: 0.5,
                typography: 'caption',
                color: 'text.secondary',
              }}
            >
              {rest.map((c) => (
                // Header-less columns (row actions) span the card, right-aligned.
                <Box key={c.header} sx={c.header ? undefined : { gridColumn: '1 / -1' }}>
                  {c.header ? `${c.header}: ` : null}
                  {c.render(row)}
                </Box>
              ))}
            </Box>
          </Card>
        );
      })}
    </Stack>
  );
}
