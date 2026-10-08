export interface CalendarDay {
  date: string
  day: string
  isCurrentMonth: boolean
  isToday: boolean
  isSelected: boolean
  isDisabled: boolean
}

export interface CalendarMonthState {
  monthDate: string
  monthLabel: string
  days: CalendarDay[]
  canPrev: boolean
  canNext: boolean
}

export const CALENDAR_WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日']

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const CALENDAR_CELL_COUNT = 42

/**
 * 生成底部日历弹窗需要的单月网格。
 * 参数说明：
 * - monthDate：当前展示月份内的任意一天，格式 YYYY-MM-DD。
 * - selectedDate：当前已选日期，格式 YYYY-MM-DD。
 * - minDate/maxDate：可选择的日期范围，超出范围的日期会置灰且不可选。
 *
 * 注意：这里不调用任何 wx API，方便复用和单独排查日期计算问题。
 */
export function buildCalendarMonthState(
  monthDate: string,
  selectedDate: string,
  minDate: string,
  maxDate: string,
): CalendarMonthState {
  const safeMonth = parseCalendarDate(monthDate) || new Date()
  const safeSelectedDate = isCalendarDate(selectedDate) ? selectedDate : formatCalendarDate(new Date())
  const safeMinDate = isCalendarDate(minDate) ? minDate : formatCalendarDate(new Date())
  const safeMaxDate = isCalendarDate(maxDate) ? maxDate : safeMinDate
  const monthStart = new Date(safeMonth.getFullYear(), safeMonth.getMonth(), 1)
  const leadingDayCount = (monthStart.getDay() + 6) % 7
  const gridStart = new Date(monthStart.getFullYear(), monthStart.getMonth(), 1 - leadingDayCount)
  const todayDate = formatCalendarDate(new Date())
  const currentMonthDate = formatCalendarDate(monthStart)
  const minMonthDate = formatCalendarDate(createMonthStart(safeMinDate))
  const maxMonthDate = formatCalendarDate(createMonthStart(safeMaxDate))
  const days: CalendarDay[] = []

  for (let index = 0; index < CALENDAR_CELL_COUNT; index += 1) {
    const cellDate = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + index)
    const dateText = formatCalendarDate(cellDate)

    days.push({
      date: dateText,
      day: String(cellDate.getDate()),
      isCurrentMonth: cellDate.getMonth() === monthStart.getMonth(),
      isToday: dateText === todayDate,
      isSelected: dateText === safeSelectedDate,
      isDisabled: dateText < safeMinDate || dateText > safeMaxDate,
    })
  }

  return {
    monthDate: currentMonthDate,
    monthLabel: `${monthStart.getFullYear()}年 ${String(monthStart.getMonth() + 1).padStart(2, '0')}月`,
    days,
    canPrev: currentMonthDate > minMonthDate,
    canNext: currentMonthDate < maxMonthDate,
  }
}

/**
 * 月份切换工具。
 * offset 为 -1 表示上个月，1 表示下个月。
 */
export function shiftCalendarMonth(monthDate: string, offset: number): string {
  const safeDate = parseCalendarDate(monthDate) || new Date()
  return formatCalendarDate(new Date(safeDate.getFullYear(), safeDate.getMonth() + offset, 1))
}

export function getCalendarMonthAnchor(taskDate: string): string {
  const safeDate = parseCalendarDate(taskDate) || new Date()
  return formatCalendarDate(new Date(safeDate.getFullYear(), safeDate.getMonth(), 1))
}

function isCalendarDate(value: string): boolean {
  return DATE_PATTERN.test(value)
}

function parseCalendarDate(value: string): Date | null {
  if (!isCalendarDate(value)) {
    return null
  }

  const [year, month, day] = value.split('-').map(Number)
  return new Date(year, month - 1, day)
}

function formatCalendarDate(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function createMonthStart(taskDate: string): Date {
  const date = parseCalendarDate(taskDate) || new Date()
  return new Date(date.getFullYear(), date.getMonth(), 1)
}
