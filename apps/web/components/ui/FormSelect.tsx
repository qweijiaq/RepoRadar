'use client'

import { useState } from 'react'
import { UiSelect, type UiSelectOption } from './Select'

export function FormSelect({
  name,
  defaultValue = '',
  options,
  ariaLabel,
  placeholder = '请选择',
}: {
  name: string
  defaultValue?: string
  options: UiSelectOption[]
  ariaLabel?: string
  placeholder?: string
}) {
  const [value, setValue] = useState(defaultValue)
  return (
    <UiSelect
      name={name}
      value={value}
      onChange={setValue}
      options={options}
      ariaLabel={ariaLabel}
      placeholder={placeholder}
    />
  )
}
