import { redirectLegacy } from '@/lib/legacy-redirect'

export default function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectLegacy(searchParams, '/library?tab=history')
}
