'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

const TABS = [
  { href: '/workbench/maintain', label: '维护' },
  { href: '/workbench/integrations', label: '接入' },
  { href: '/workbench/swap', label: '换库' },
  { href: '/workbench/contribute', label: '贡献' },
  { href: '/workbench/watch', label: '关注' },
  { href: '/workbench/issue', label: '周报' },
  { href: '/workbench/copilot', label: '问雷达' },
]

export function WorkbenchTabs() {
  const pathname = usePathname()
  return (
    <nav className="workbench-tabs" aria-label="工作台导航">
      <span className="workbench-label">工作台</span>
      {TABS.map((tab) => (
        <Link
          key={tab.href}
          href={tab.href}
          className={pathname?.startsWith(tab.href) ? 'workbench-tab active' : 'workbench-tab'}
        >
          {tab.label}
        </Link>
      ))}
    </nav>
  )
}
