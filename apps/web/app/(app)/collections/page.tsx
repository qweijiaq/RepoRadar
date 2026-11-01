import { redirect } from 'next/navigation'

export default function CollectionsPage() {
  redirect('/feed?tab=collections')
}
