// Define the interface for TypeScript to know about our exposed API
declare global {
  interface Window {
    browserApi: {
      navigate: (url: string) => void
      goBack: () => void
      goForward: () => void
      reload: () => void
      onUrlChange: (callback: (url: string) => void) => void
    }
  }
}

const input = document.getElementById('url-input') as HTMLInputElement
const button = document.getElementById('go-btn') as HTMLButtonElement
const backBtn = document.getElementById('back-btn') as HTMLButtonElement
const forwardBtn = document.getElementById('forward-btn') as HTMLButtonElement
const reloadBtn = document.getElementById('reload-btn') as HTMLButtonElement

const navigate = () => {
  const url = input.value.trim()
  if (url) {
    window.browserApi.navigate(url)
  }
}

button.addEventListener('click', navigate)

input.addEventListener('keypress', (e: KeyboardEvent) => {
  if (e.key === 'Enter') navigate()
})

backBtn.addEventListener('click', () => window.browserApi.goBack())
forwardBtn.addEventListener('click', () => window.browserApi.goForward())
reloadBtn.addEventListener('click', () => window.browserApi.reload())

window.browserApi.onUrlChange((newUrl) => {
  input.value = newUrl
})