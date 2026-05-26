import ConversationPage from './view'

export function generateStaticParams() { return [{ id: '_' }] }

export default function Page() {
  return <ConversationPage />
}
