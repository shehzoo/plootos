import { render } from 'preact'
import { App } from './app'
import './design/tokens.css'
import './design/components.css'
import './styles.css'

render(<App />, document.getElementById('app')!)
