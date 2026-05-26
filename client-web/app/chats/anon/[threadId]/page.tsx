import AnonThreadPage from './view'

export function generateStaticParams() { return [{ threadId: '_' }] }

export default function Page() {
  return <AnonThreadPage />
}
