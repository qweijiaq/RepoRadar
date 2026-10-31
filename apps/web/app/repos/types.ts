export interface RepoActionResult {
  status: 'idle' | 'success' | 'partial' | 'error'
  message: string
  details: string[]
}

export const initialRepoActionState: RepoActionResult = {
  status: 'idle',
  message: '',
  details: [],
}
