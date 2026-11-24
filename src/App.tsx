import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  IonApp,
  IonButton,
  IonChip,
  IonContent,
  IonIcon,
  IonInput,
  IonItem,
  IonLabel,
  IonList,
  IonPage,
  IonReorder,
  IonReorderGroup,
  IonRouterOutlet,
  IonTabBar,
  IonTabButton,
  IonTabs,
  setupIonicReact,
} from '@ionic/react'
import { IonReactRouter } from '@ionic/react-router'
import Decimal from 'decimal.js'
import {
  add,
  alertCircleOutline,
  arrowBack,
  checkmark,
  globeOutline,
  pencilOutline,
  refreshOutline,
  remove,
  reorderThreeOutline,
  saveOutline,
  swapHorizontalOutline,
} from 'ionicons/icons'
import { Navigate, Route } from 'react-router-dom'
import './App.css'

setupIonicReact()
Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP })

type LiveState = 'live' | 'cached' | 'offline' | 'missing-key'
type CurrencySource = 'api' | 'manual'
type ApiStatus = 'unknown' | 'valid' | 'invalid'

type CatalogCurrency = {
  code: string
  name: string
}

type ActiveCurrency = {
  code: string
  name: string
  source: CurrencySource
  apiStatus: ApiStatus
}

type RatesSnapshot = {
  rates: Record<string, string>
  fetchedAt: string
}

type AddManualPayload = {
  code: string
  name: string
  usdPerUnit: string
}

type UpdateCurrencyPayload = {
  code: string
  name: string
  usdPerUnit: string
}

const CURRENCY_CACHE_KEY = 'cambio:rates:v3'
const ACTIVE_CURRENCIES_KEY = 'cambio:active-currencies:v3'
const CATALOG_CACHE_KEY = 'cambio:catalog-all:v3'
const BASE_CURRENCY_KEY = 'cambio:base-currency:v3'
const REFRESH_INTERVAL_MS = 5 * 60 * 1000
const FALLBACK_FETCHED_AT = '1970-01-01T00:00:00.000Z'

const normalizeCurrencyCode = (value: string) =>
  value.toUpperCase().trim().replace(/[^A-Z]/g, '')

const parsePositiveDecimal = (value: string): Decimal | null => {
  const normalized = value.replace(',', '.').trim()
  if (!normalized) {
    return null
  }
  try {
    const parsed = new Decimal(normalized)
    return parsed.gt(0) ? parsed : null
  } catch {
    return null
  }
}

const readStorage = <T,>(key: string): T | null => {
  const rawValue = localStorage.getItem(key)
  if (!rawValue) {
    return null
  }
  try {
    return JSON.parse(rawValue) as T
  } catch {
    return null
  }
}

const saveCachedRates = (snapshot: RatesSnapshot) => {
  localStorage.setItem(CURRENCY_CACHE_KEY, JSON.stringify(snapshot))
}

const readCachedRates = (): RatesSnapshot | null => {
  const parsed = readStorage<RatesSnapshot>(CURRENCY_CACHE_KEY)
  if (!parsed?.rates || !parsed?.fetchedAt) {
    return null
  }
  return parsed
}

const formatTime = (isoDate: string) =>
  new Date(isoDate).toLocaleTimeString('es-CO', {
    hour: '2-digit',
    minute: '2-digit',
  })

const formatDecimalForUI = (value: Decimal) => {
  const rounded = value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP)
  const fixed = rounded.toFixed(2).replace(/(\.\d*[1-9])0$|\.0$/g, '$1')
  const normalized = fixed.includes('.') ? fixed : `${fixed}.0`
  const [integerPart, decimalPart] = normalized.split('.')
  const groupedInteger = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return decimalPart ? `${groupedInteger},${decimalPart}` : groupedInteger
}

const getColorClass = (code: string) => {
  const classes = [
    'currency-icon--purple',
    'currency-icon--cream',
    'currency-icon--blue',
    'currency-icon--green',
    'currency-icon--rose',
  ]
  let sum = 0
  for (let index = 0; index < code.length; index += 1) {
    sum += code.charCodeAt(index)
  }
  return classes[sum % classes.length]
}

const requestLatestRates = async (
  apiKey: string,
  symbols: string[],
): Promise<Record<string, string>> => {
  const uniqueSymbols = Array.from(new Set(symbols.map(normalizeCurrencyCode))).filter(
    Boolean,
  )
  const query = new URLSearchParams({
    apikey: apiKey,
    symbols: uniqueSymbols.join(','),
  })
  const response = await fetch(
    `https://api.currencyfreaks.com/v2.0/rates/latest?${query.toString()}`,
  )
  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    rates?: Record<string, string | number | undefined>
  }
  if (!payload.rates) {
    throw new Error('Respuesta inválida de CurrencyFreaks.')
  }

  const parsed: Record<string, string> = { USD: '1' }
  Object.entries(payload.rates).forEach(([code, rawRate]) => {
    const normalizedCode = normalizeCurrencyCode(code)
    const asText =
      typeof rawRate === 'number' ? rawRate.toString() : rawRate?.toString() ?? ''
    const asDecimal = parsePositiveDecimal(asText)
    if (asDecimal && normalizedCode) {
      parsed[normalizedCode] = asDecimal.toString()
    }
  })

  return parsed
}

const requestSupportedCurrencies = async (): Promise<CatalogCurrency[]> => {
  const response = await fetch('https://api.currencyfreaks.com/v2.0/supported-currencies')
  if (!response.ok) {
    throw new Error(`Error HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    supportedCurrenciesMap?: Record<
      string,
      { currencyCode?: string; currencyName?: string; status?: string }
    >
  }
  if (!payload.supportedCurrenciesMap) {
    throw new Error('Respuesta inválida en catálogo de monedas.')
  }

  return Object.values(payload.supportedCurrenciesMap)
    .filter((entry) => entry.currencyCode && entry.currencyName)
    .filter((entry) => entry.status !== 'DEPRECATED')
    .map((entry) => ({
      code: normalizeCurrencyCode(entry.currencyCode ?? ''),
      name: entry.currencyName?.trim() ?? '',
    }))
    .filter((entry) => entry.code.length === 3 && entry.name.length > 0)
    .sort((a, b) => a.code.localeCompare(b.code))
}

const convertAmount = (
  amountText: string,
  baseCode: string,
  targetCode: string,
  rates: Record<string, string>,
) => {
  const amount = parsePositiveDecimal(amountText) ?? new Decimal(0)
  const baseRate = parsePositiveDecimal(rates[baseCode] ?? '')
  const targetRate = parsePositiveDecimal(rates[targetCode] ?? '')
  if (!baseRate || !targetRate) {
    return new Decimal(0)
  }
  return amount.mul(targetRate).div(baseRate)
}

type ConverterPageProps = {
  baseAmount: string
  onBaseAmountChange: (value: string) => void
  baseCurrency: ActiveCurrency
  activeCurrencies: ActiveCurrency[]
  rates: Record<string, string>
  ratesState: LiveState
  lastUpdatedAt: string
  statusMessage: string
  onCalibrate: () => Promise<void>
  isCalibrating: boolean
  onSwitchBase: (code: string) => void
  onReorder: (from: number, to: number) => void
}

const ConverterPage = ({
  baseAmount,
  onBaseAmountChange,
  baseCurrency,
  activeCurrencies,
  rates,
  ratesState,
  lastUpdatedAt,
  statusMessage,
  onCalibrate,
  isCalibrating,
  onSwitchBase,
  onReorder,
}: ConverterPageProps) => {
  const badgeText =
    ratesState === 'live'
      ? 'En tiempo real'
      : ratesState === 'cached'
        ? 'Datos en caché'
        : ratesState === 'missing-key'
          ? 'Configura API key'
          : 'Sin conexión'

  return (
    <IonPage>
      <IonContent fullscreen>
        <section className="screen">
          <header className="header">
            <div className="header-brand">
              <IonButton fill="clear" className="icon-button" aria-label="Atrás">
                <IonIcon icon={arrowBack} />
              </IonButton>
              <span className="brand-text">cambio</span>
            </div>
            <div className={`live-badge live-badge--${ratesState}`}>{badgeText}</div>
          </header>

          <h1>Un monto. Tus monedas.</h1>
          <p className="subtitle">
            Toca una tarjeta para cambiar moneda base y arrastra para ordenar.
          </p>

          <article className="card card--base">
            <div className="card-top">
              <div>
                <strong>{baseCurrency.code}</strong>
                <p>{baseCurrency.name}</p>
              </div>
              <span className="tag">Moneda base</span>
            </div>
            <label className="base-input">
              <IonInput
                aria-label="Monto base"
                value={baseAmount}
                type="text"
                inputmode="decimal"
                onIonInput={(event) =>
                  onBaseAmountChange(event.detail.value?.toString() ?? '')
                }
              />
              <span>{baseCurrency.code}</span>
            </label>
          </article>

          <div className="conversion-list">
            {activeCurrencies.length === 0 ? (
              <article className="empty-state">
                No tienes monedas activas. Agrégalas en “Mis monedas”.
              </article>
            ) : null}

            <IonReorderGroup
              disabled={false}
              onIonItemReorder={(event) => {
                const detail = event.detail as {
                  from: number
                  to: number
                  complete: () => void
                }
                onReorder(detail.from, detail.to)
                detail.complete()
              }}
            >
              {activeCurrencies.map((currency) => {
                const convertedValue = convertAmount(
                  baseAmount,
                  baseCurrency.code,
                  currency.code,
                  rates,
                )

                return (
                  <IonItem
                    key={currency.code}
                    lines="none"
                    className="currency-row converter-row"
                    onClick={() => onSwitchBase(currency.code)}
                  >
                    <div className="target-main">
                      <div className={`currency-icon ${getColorClass(currency.code)}`}>
                        {currency.code}
                      </div>
                      <div>
                        <strong>
                          {currency.code}
                          {currency.apiStatus === 'invalid' ? (
                            <IonIcon icon={alertCircleOutline} className="warning-icon" />
                          ) : null}
                        </strong>
                        <p>{currency.name}</p>
                      </div>
                    </div>
                    <div className="target-value">
                      <small>Equivale a</small>
                      <strong>{formatDecimalForUI(convertedValue)}</strong>
                    </div>
                    <IonReorder slot="end">
                      <IonIcon icon={reorderThreeOutline} className="reorder-hint" />
                    </IonReorder>
                  </IonItem>
                )
              })}
            </IonReorderGroup>
          </div>

          <IonButton
            fill="outline"
            className="calibrate-button"
            onClick={() => void onCalibrate()}
            disabled={isCalibrating}
          >
            {isCalibrating ? 'Calibrando…' : 'Calibrar tasas'}
          </IonButton>

          <div className="info-row">
            <IonIcon icon={refreshOutline} />
            <div>
              <strong>Estado de sincronización</strong>
              <p>Última sincronización: {formatTime(lastUpdatedAt)}.</p>
              {statusMessage ? <p className="status-message">{statusMessage}</p> : null}
            </div>
          </div>
        </section>
      </IonContent>
    </IonPage>
  )
}

type ConfigPageProps = {
  query: string
  onQueryChange: (value: string) => void
  catalog: CatalogCurrency[]
  activeCurrencies: ActiveCurrency[]
  baseCurrency: ActiveCurrency
  rates: Record<string, string>
  onSelectFromCatalog: (code: string) => Promise<string>
  onRemoveCurrency: (code: string) => void
  onAddManualOffline: (payload: AddManualPayload) => Promise<string>
  onUpdateCurrency: (payload: UpdateCurrencyPayload) => Promise<string>
  online: boolean
  catalogMessage: string
}

const ConfigPage = ({
  query,
  onQueryChange,
  catalog,
  activeCurrencies,
  baseCurrency,
  rates,
  onSelectFromCatalog,
  onRemoveCurrency,
  onAddManualOffline,
  onUpdateCurrency,
  online,
  catalogMessage,
}: ConfigPageProps) => {
  const [newCode, setNewCode] = useState('')
  const [newName, setNewName] = useState('')
  const [usdPerUnit, setUsdPerUnit] = useState('')
  const [feedback, setFeedback] = useState('')
  const [editingCode, setEditingCode] = useState<string | null>(null)
  const [editingName, setEditingName] = useState('')
  const [editingUsdPerUnit, setEditingUsdPerUnit] = useState('')

  const activeCodes = useMemo(
    () => new Set(activeCurrencies.map((currency) => currency.code)),
    [activeCurrencies],
  )

  const filteredCatalog = useMemo(() => {
    if (!query.trim()) {
      return catalog.slice(0, 10)
    }
    const normalizedQuery = query.toLowerCase()
    return catalog
      .filter(
        (currency) =>
          currency.code.toLowerCase().includes(normalizedQuery) ||
          currency.name.toLowerCase().includes(normalizedQuery),
      )
      .slice(0, 10)
  }, [catalog, query])

  const handleManualAdd = async () => {
    const result = await onAddManualOffline({
      code: newCode,
      name: newName,
      usdPerUnit,
    })
    setFeedback(result)
    if (result.startsWith('Moneda')) {
      setNewCode('')
      setNewName('')
      setUsdPerUnit('')
    }
  }

  const handleSelectFromCatalog = async (code: string) => {
    const result = await onSelectFromCatalog(code)
    setFeedback(result)
  }

  const startEditing = (currency: ActiveCurrency) => {
    setEditingCode(currency.code)
    setEditingName(currency.name)
    const rate = parsePositiveDecimal(rates[currency.code] ?? '')
    setEditingUsdPerUnit(rate ? new Decimal(1).div(rate).toFixed(10) : '')
  }

  const handleSaveEdit = async () => {
    if (!editingCode) {
      return
    }
    const result = await onUpdateCurrency({
      code: editingCode,
      name: editingName,
      usdPerUnit: editingUsdPerUnit,
    })
    setFeedback(result)
    if (result.startsWith('Moneda')) {
      setEditingCode(null)
      setEditingName('')
      setEditingUsdPerUnit('')
    }
  }

  return (
    <IonPage>
      <IonContent fullscreen>
        <section className="screen">
          <header className="header">
            <IonButton fill="clear" className="icon-button" routerLink="/conversor">
              <IonIcon icon={arrowBack} />
            </IonButton>
          </header>

          <h1>Configurar monedas</h1>
          <p className="subtitle">
            Base actual: <strong>{baseCurrency.code}</strong> ({baseCurrency.name})
          </p>

          <IonItem lines="none" className="search-input">
            <IonIcon icon={globeOutline} slot="start" />
            <IonInput
              aria-label="Buscar moneda"
              value={query}
              placeholder="Buscar moneda por código o nombre"
              onIonInput={(event) => onQueryChange(event.detail.value?.toString() ?? '')}
            />
          </IonItem>

          <p className="add-currency-help">
            {catalogMessage || `Catálogo cargado: ${catalog.length} monedas disponibles.`}
          </p>

          {!online ? (
            <div className="add-currency-box">
              <h3>Agregar manual (sin internet)</h3>
              <IonInput
                className="inline-input"
                value={newCode}
                maxlength={3}
                placeholder="Código de 3 letras (ej: BRL)"
                onIonInput={(event) => setNewCode(event.detail.value?.toString() ?? '')}
              />
              <IonInput
                className="inline-input"
                value={newName}
                placeholder="Nombre de moneda"
                onIonInput={(event) => setNewName(event.detail.value?.toString() ?? '')}
              />
              <IonInput
                className="inline-input"
                value={usdPerUnit}
                type="number"
                inputmode="decimal"
                placeholder="1 moneda = ? USD (ej: 0.17)"
                onIonInput={(event) =>
                  setUsdPerUnit(event.detail.value?.toString() ?? '')
                }
              />
              <IonButton className="secondary-button" onClick={() => void handleManualAdd()}>
                Agregar manual
              </IonButton>
            </div>
          ) : null}

          <div className="selection-header">
            <span>Monedas activas</span>
            <strong>{activeCurrencies.length}</strong>
          </div>

          <div className="chip-list">
            {activeCurrencies.map((currency) => (
              <IonChip key={currency.code}>
                {currency.code}
                {currency.apiStatus === 'invalid' ? (
                  <IonIcon icon={alertCircleOutline} className="warning-icon warning-icon--chip" />
                ) : null}
              </IonChip>
            ))}
          </div>

          <IonList lines="none" className="currency-list">
            {activeCurrencies.map((currency) => (
              <IonItem key={currency.code} className="currency-row">
                <div className={`currency-icon ${getColorClass(currency.code)}`}>
                  {currency.code}
                </div>
                <IonLabel>
                  <strong>
                    {currency.code}
                    {currency.apiStatus === 'invalid' ? (
                      <IonIcon icon={alertCircleOutline} className="warning-icon" />
                    ) : null}
                  </strong>
                  <p>{currency.name}</p>
                </IonLabel>
                <div className="row-actions">
                  <IonButton
                    fill="clear"
                    className="icon-action-button"
                    onClick={() => startEditing(currency)}
                    aria-label="Editar moneda"
                  >
                    <IonIcon icon={pencilOutline} />
                  </IonButton>
                  <IonButton
                    fill="clear"
                    className="icon-action-button"
                    onClick={() => onRemoveCurrency(currency.code)}
                    aria-label="Quitar moneda"
                  >
                    <IonIcon icon={remove} />
                  </IonButton>
                </div>
              </IonItem>
            ))}
          </IonList>

          {editingCode ? (
            <div className="add-currency-box">
              <h3>Editar {editingCode}</h3>
              <IonInput
                className="inline-input"
                value={editingName}
                placeholder="Nombre de moneda"
                onIonInput={(event) => setEditingName(event.detail.value?.toString() ?? '')}
              />
              <IonInput
                className="inline-input"
                value={editingUsdPerUnit}
                type="number"
                inputmode="decimal"
                placeholder="1 moneda = ? USD"
                onIonInput={(event) =>
                  setEditingUsdPerUnit(event.detail.value?.toString() ?? '')
                }
              />
              <IonButton className="secondary-button" onClick={() => void handleSaveEdit()}>
                <IonIcon icon={saveOutline} slot="start" />
                Guardar edición
              </IonButton>
            </div>
          ) : null}

          <h2>Buscar y seleccionar</h2>
          <IonList lines="none" className="currency-list">
            {filteredCatalog.map((currency) => {
              const isSelected = activeCodes.has(currency.code)
              return (
                <IonItem key={currency.code} className="currency-row">
                  <div className={`currency-icon ${getColorClass(currency.code)}`}>
                    {currency.code}
                  </div>
                  <IonLabel>
                    <strong>{currency.code}</strong>
                    <p>{currency.name}</p>
                  </IonLabel>
                  <IonButton
                    fill="solid"
                    className={`toggle-button ${isSelected ? 'is-selected' : ''}`}
                    onClick={() =>
                      isSelected
                        ? onRemoveCurrency(currency.code)
                        : void handleSelectFromCatalog(currency.code)
                    }
                    aria-label={isSelected ? 'Quitar moneda' : 'Agregar moneda'}
                  >
                    <IonIcon icon={isSelected ? checkmark : add} />
                  </IonButton>
                </IonItem>
              )
            })}
          </IonList>

          {feedback ? <p className="status-message">{feedback}</p> : null}
        </section>
      </IonContent>
    </IonPage>
  )
}

function App() {
  const initialBaseCurrencyCode =
    normalizeCurrencyCode(localStorage.getItem(BASE_CURRENCY_KEY) ?? 'USD') || 'USD'

  const [baseAmount, setBaseAmount] = useState('100')
  const [searchQuery, setSearchQuery] = useState('')
  const [catalog, setCatalog] = useState<CatalogCurrency[]>(
    () => readStorage<CatalogCurrency[]>(CATALOG_CACHE_KEY) ?? [],
  )
  const [catalogMessage, setCatalogMessage] = useState('')
  const [activeCurrencies, setActiveCurrencies] = useState<ActiveCurrency[]>(
    () =>
      (readStorage<ActiveCurrency[]>(ACTIVE_CURRENCIES_KEY) ?? []).filter(
        (currency, index, all) =>
          currency.code !== initialBaseCurrencyCode &&
          all.findIndex((item) => item.code === currency.code) === index,
      ),
  )
  const [baseCurrencyCode, setBaseCurrencyCode] = useState<string>(
    () => initialBaseCurrencyCode,
  )
  const [ratesSnapshot, setRatesSnapshot] = useState<RatesSnapshot>(
    () =>
      readCachedRates() ?? {
        rates: { USD: '1' },
        fetchedAt: FALLBACK_FETCHED_AT,
      },
  )
  const [ratesState, setRatesState] = useState<LiveState>(() =>
    navigator.onLine ? 'cached' : 'offline',
  )
  const [statusMessage, setStatusMessage] = useState('')
  const [isCalibrating, setIsCalibrating] = useState(false)
  const [isOnline, setIsOnline] = useState(() => navigator.onLine)

  const currencyFreaksApiKey =
    import.meta.env.VITE_CURRENCYFREAKS_API_KEY?.toString().trim() ?? ''

  const lookupName = useCallback(
    (code: string) =>
      catalog.find((entry) => entry.code === code)?.name ??
      activeCurrencies.find((entry) => entry.code === code)?.name ??
      code,
    [catalog, activeCurrencies],
  )

  const baseCurrency: ActiveCurrency = useMemo(
    () => ({
      code: baseCurrencyCode,
      name: lookupName(baseCurrencyCode),
      source: 'api',
      apiStatus: 'valid',
    }),
    [baseCurrencyCode, lookupName],
  )

  useEffect(() => {
    localStorage.setItem(ACTIVE_CURRENCIES_KEY, JSON.stringify(activeCurrencies))
  }, [activeCurrencies])

  useEffect(() => {
    localStorage.setItem(CATALOG_CACHE_KEY, JSON.stringify(catalog))
  }, [catalog])

  useEffect(() => {
    localStorage.setItem(BASE_CURRENCY_KEY, baseCurrencyCode)
  }, [baseCurrencyCode])

  const loadCatalog = useCallback(async () => {
    if (!navigator.onLine) {
      setCatalogMessage('Sin internet: usando catálogo local guardado.')
      return
    }
    try {
      const supportedCurrencies = await requestSupportedCurrencies()
      setCatalog(supportedCurrencies)
      setCatalogMessage('Catálogo actualizado desde la API.')
    } catch (error) {
      setCatalogMessage(
        error instanceof Error
          ? `No se pudo actualizar catálogo: ${error.message}.`
          : 'No se pudo actualizar catálogo.',
      )
    }
  }, [])

  const updateRateForCode = useCallback((code: string, ratePerUsd: Decimal) => {
    setRatesSnapshot((previousSnapshot) => {
      const nextSnapshot = {
        rates: {
          ...previousSnapshot.rates,
          [code]: ratePerUsd.toString(),
          USD: '1',
        },
        fetchedAt: previousSnapshot.fetchedAt,
      }
      saveCachedRates(nextSnapshot)
      return nextSnapshot
    })
  }, [])

  const addManualOffline = useCallback(
    async ({ code, name, usdPerUnit }: AddManualPayload) => {
      if (navigator.onLine) {
        return 'El alta manual solo aplica sin internet.'
      }

      const normalizedCode = normalizeCurrencyCode(code)
      if (normalizedCode.length !== 3) {
        return 'El código debe tener exactamente 3 letras.'
      }
      if (normalizedCode === baseCurrencyCode) {
        return 'Ese código ya es tu moneda base.'
      }
      if (activeCurrencies.some((currency) => currency.code === normalizedCode)) {
        return `La moneda ${normalizedCode} ya está activa.`
      }

      const parsedUsd = parsePositiveDecimal(usdPerUnit)
      if (!parsedUsd) {
        return 'Debes indicar un valor válido para 1 moneda = ? USD.'
      }

      const nextCurrency: ActiveCurrency = {
        code: normalizedCode,
        name: name.trim() || normalizedCode,
        source: 'manual',
        apiStatus: 'unknown',
      }

      setActiveCurrencies((previous) => [...previous, nextCurrency])
      updateRateForCode(normalizedCode, new Decimal(1).div(parsedUsd))
      setRatesState('offline')
      setStatusMessage(
        `Moneda ${normalizedCode} agregada localmente. Calibra al volver la conexión.`,
      )
      return `Moneda ${normalizedCode} agregada correctamente.`
    },
    [activeCurrencies, baseCurrencyCode, updateRateForCode],
  )

  const selectFromCatalog = useCallback(
    async (code: string) => {
      const normalizedCode = normalizeCurrencyCode(code)
      if (normalizedCode === baseCurrencyCode) {
        return 'Esa moneda ya es la base.'
      }
      if (activeCurrencies.some((currency) => currency.code === normalizedCode)) {
        return `La moneda ${normalizedCode} ya está activa.`
      }
      if (!navigator.onLine) {
        return 'Sin internet no se puede autocalcular. Usa el formulario manual.'
      }
      if (!currencyFreaksApiKey) {
        setRatesState('missing-key')
        return 'Configura VITE_CURRENCYFREAKS_API_KEY para autocalcular tasas.'
      }

      try {
        const latestRates = await requestLatestRates(currencyFreaksApiKey, [normalizedCode])
        const apiRate = parsePositiveDecimal(latestRates[normalizedCode] ?? '')
        if (!apiRate) {
          return `La API no devolvió tasa para ${normalizedCode}.`
        }

        const entry = catalog.find((item) => item.code === normalizedCode)
        const nextCurrency: ActiveCurrency = {
          code: normalizedCode,
          name: entry?.name ?? normalizedCode,
          source: 'api',
          apiStatus: 'valid',
        }
        setActiveCurrencies((previous) => [...previous, nextCurrency])
        setRatesSnapshot((previousSnapshot) => {
          const nextSnapshot = {
            rates: {
              ...previousSnapshot.rates,
              [normalizedCode]: apiRate.toString(),
              USD: '1',
            },
            fetchedAt: new Date().toISOString(),
          }
          saveCachedRates(nextSnapshot)
          return nextSnapshot
        })
        setRatesState('live')
        setStatusMessage(`Moneda ${normalizedCode} agregada con tasa real.`)
        return `Moneda ${normalizedCode} agregada correctamente.`
      } catch (error) {
        setRatesState('cached')
        return error instanceof Error
          ? `No se pudo agregar ${normalizedCode}: ${error.message}.`
          : `No se pudo agregar ${normalizedCode}.`
      }
    },
    [activeCurrencies, baseCurrencyCode, catalog, currencyFreaksApiKey],
  )

  const removeCurrency = (code: string) => {
    setActiveCurrencies((previous) => previous.filter((currency) => currency.code !== code))
  }

  const updateCurrency = useCallback(
    async ({ code, name, usdPerUnit }: UpdateCurrencyPayload) => {
      const normalizedCode = normalizeCurrencyCode(code)
      const exists = activeCurrencies.some((item) => item.code === normalizedCode)
      if (!exists) {
        return `No se encontró ${normalizedCode} para editar.`
      }

      const parsedUsd = parsePositiveDecimal(usdPerUnit)
      if (!parsedUsd) {
        return 'Ingresa una equivalencia válida en USD.'
      }

      setActiveCurrencies((previous) =>
        previous.map((item) =>
          item.code === normalizedCode
            ? {
                ...item,
                name: name.trim() || item.name,
                source: 'manual',
                apiStatus: 'unknown',
              }
            : item,
        ),
      )
      updateRateForCode(normalizedCode, new Decimal(1).div(parsedUsd))
      setStatusMessage(`Moneda ${normalizedCode} editada localmente.`)
      return `Moneda ${normalizedCode} actualizada correctamente.`
    },
    [activeCurrencies, updateRateForCode],
  )

  const switchBase = (targetCode: string) => {
    if (targetCode === baseCurrencyCode) {
      return
    }

    const targetIndex = activeCurrencies.findIndex((currency) => currency.code === targetCode)
    if (targetIndex < 0) {
      return
    }

    const targetCurrency = activeCurrencies[targetIndex]
    const previousBase: ActiveCurrency = {
      code: baseCurrencyCode,
      name: lookupName(baseCurrencyCode),
      source: 'api',
      apiStatus: 'valid',
    }

    setBaseCurrencyCode(targetCurrency.code)
    setActiveCurrencies((previous) => {
      const next = [...previous]
      next[targetIndex] = previousBase
      return next
    })
    setStatusMessage(`La moneda base ahora es ${targetCurrency.code}.`)
  }

  const reorderCurrencies = (from: number, to: number) => {
    setActiveCurrencies((previous) => {
      if (from < 0 || to < 0 || from >= previous.length || to >= previous.length) {
        return previous
      }
      const next = [...previous]
      const [moved] = next.splice(from, 1)
      next.splice(to, 0, moved)
      return next
    })
  }

  const calibrateRates = useCallback(async () => {
    if (!navigator.onLine) {
      setRatesState('offline')
      setStatusMessage('No hay internet. Calibración no disponible.')
      return
    }
    if (!currencyFreaksApiKey) {
      setRatesState('missing-key')
      setStatusMessage('Agrega VITE_CURRENCYFREAKS_API_KEY para calibrar.')
      return
    }

    const allCodes = [baseCurrencyCode, ...activeCurrencies.map((currency) => currency.code)]
    if (allCodes.length === 0) {
      setStatusMessage('No hay monedas para calibrar.')
      return
    }

    setIsCalibrating(true)
    try {
      const latestRates = await requestLatestRates(currencyFreaksApiKey, allCodes)
      const invalidCodes: string[] = []

      setActiveCurrencies((previous) =>
        previous.map((currency) => {
          const apiRate = parsePositiveDecimal(latestRates[currency.code] ?? '')
          if (!apiRate) {
            invalidCodes.push(currency.code)
            return { ...currency, apiStatus: 'invalid' }
          }
          return { ...currency, apiStatus: 'valid', source: 'api' }
        }),
      )

      setRatesSnapshot((previousSnapshot) => {
        const nextRates: Record<string, string> = {
          ...previousSnapshot.rates,
          USD: '1',
        }
        allCodes.forEach((code) => {
          const apiRate = parsePositiveDecimal(latestRates[code] ?? '')
          if (apiRate) {
            nextRates[code] = apiRate.toString()
          }
        })
        const nextSnapshot = {
          rates: nextRates,
          fetchedAt: new Date().toISOString(),
        }
        saveCachedRates(nextSnapshot)
        return nextSnapshot
      })

      setRatesState('live')
      setStatusMessage(
        invalidCodes.length > 0
          ? `Calibración parcial. Monedas no encontradas: ${invalidCodes.join(', ')}.`
          : 'Calibración completada para todas las monedas activas.',
      )
    } catch (error) {
      setRatesState('cached')
      setStatusMessage(
        error instanceof Error
          ? `Falló calibración: ${error.message}.`
          : 'Falló calibración.',
      )
    } finally {
      setIsCalibrating(false)
    }
  }, [activeCurrencies, baseCurrencyCode, currencyFreaksApiKey])

  useEffect(() => {
    const startupTimeoutId = window.setTimeout(() => {
      void loadCatalog()
    }, 0)
    return () => {
      window.clearTimeout(startupTimeoutId)
    }
  }, [loadCatalog])

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      if (navigator.onLine) {
        void loadCatalog()
      }
    }, REFRESH_INTERVAL_MS)

    const handleOnline = () => {
      setIsOnline(true)
      void loadCatalog()
    }

    const handleOffline = () => {
      setIsOnline(false)
      setRatesState('offline')
      setStatusMessage('Sin internet. Operando con datos locales.')
    }

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [loadCatalog])

  return (
    <IonApp>
      <IonReactRouter>
        <IonTabs>
          <IonRouterOutlet>
            <Route
              path="/conversor"
              element={
                <ConverterPage
                  baseAmount={baseAmount}
                  onBaseAmountChange={setBaseAmount}
                  baseCurrency={baseCurrency}
                  activeCurrencies={activeCurrencies}
                  rates={ratesSnapshot.rates}
                  ratesState={ratesState}
                  lastUpdatedAt={ratesSnapshot.fetchedAt}
                  statusMessage={statusMessage}
                  onCalibrate={calibrateRates}
                  isCalibrating={isCalibrating}
                  onSwitchBase={switchBase}
                  onReorder={reorderCurrencies}
                />
              }
            />
            <Route
              path="/configurar"
              element={
                <ConfigPage
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  catalog={catalog}
                  activeCurrencies={activeCurrencies}
                  baseCurrency={baseCurrency}
                  rates={ratesSnapshot.rates}
                  onSelectFromCatalog={selectFromCatalog}
                  onRemoveCurrency={removeCurrency}
                  onAddManualOffline={addManualOffline}
                  onUpdateCurrency={updateCurrency}
                  online={isOnline}
                  catalogMessage={catalogMessage}
                />
              }
            />
            <Route
              path="/mis-monedas"
              element={
                <ConfigPage
                  query={searchQuery}
                  onQueryChange={setSearchQuery}
                  catalog={catalog}
                  activeCurrencies={activeCurrencies}
                  baseCurrency={baseCurrency}
                  rates={ratesSnapshot.rates}
                  onSelectFromCatalog={selectFromCatalog}
                  onRemoveCurrency={removeCurrency}
                  onAddManualOffline={addManualOffline}
                  onUpdateCurrency={updateCurrency}
                  online={isOnline}
                  catalogMessage={catalogMessage}
                />
              }
            />
            <Route path="/" element={<Navigate to="/conversor" replace />} />
          </IonRouterOutlet>

          <IonTabBar slot="bottom" className="bottom-tabs">
            <IonTabButton tab="conversor" href="/conversor">
              <IonIcon icon={swapHorizontalOutline} />
              <IonLabel>Conversor</IonLabel>
            </IonTabButton>
            <IonTabButton tab="monedas" href="/mis-monedas">
              <IonIcon icon={globeOutline} />
              <IonLabel>Mis monedas</IonLabel>
            </IonTabButton>
          </IonTabBar>
        </IonTabs>
      </IonReactRouter>
    </IonApp>
  )
}

export default App
