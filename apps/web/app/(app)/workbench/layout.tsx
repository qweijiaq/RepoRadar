import { WorkbenchTabs } from './workbench-tabs'

export default function WorkbenchLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <div className="workbench-tabbar">
        <WorkbenchTabs />
      </div>
      {children}
    </>
  )
}
