import { redirectLegacy } from '@/lib/legacy-redirect'

export default function LegacyPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  return redirectLegacy(searchParams, '/workbench/issue')
}
