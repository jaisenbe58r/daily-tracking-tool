import { createContext, useContext } from 'react'
import { dateKey } from './parse'

/** Today's local date (YYYY-MM-DD), refreshed by the app so every view agrees past midnight. */
export const TodayContext = createContext(dateKey(new Date()))

export const useToday = () => useContext(TodayContext)
