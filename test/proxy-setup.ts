// Только для тестов в окружениях за HTTP-прокси.
import { setGlobalDispatcher, EnvHttpProxyAgent } from 'undici';
if (process.env.HTTPS_PROXY || process.env.https_proxy) setGlobalDispatcher(new EnvHttpProxyAgent());
