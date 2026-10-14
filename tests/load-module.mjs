import { readFile } from 'node:fs/promises'
export async function loadModule(sdk = {}) {
  globalThis.__museumTestSDK = sdk
  let source = await readFile(new URL('../desktop/plugin.js', import.meta.url), 'utf8')
  source = source.replace(/import \{([^}]+)\} from '@hermes\/plugin-sdk'/, 'const {$1} = globalThis.__museumTestSDK')
  source = source.replace(/import \{([^}]+)\} from 'react'/, 'const {$1} = {}')
  source = source.replace(/import \{([^}]+)\} from 'react\/jsx-runtime'/, 'const {$1} = {}')
  return import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))
}
