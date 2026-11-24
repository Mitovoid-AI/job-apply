import { Check, PlusCircle } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'

export interface FacetOption {
  value: string
  label: string
  count: number
}

export function FacetFilter({
  title, options, selected, onChange,
}: {
  title: string
  options: FacetOption[]
  selected: string[]
  onChange: (next: string[]) => void
}) {
  const toggle = (v: string) =>
    onChange(selected.includes(v) ? selected.filter(s => s !== v) : [...selected, v])
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-8 border-dashed">
          <PlusCircle />
          {title}
          {selected.length > 0 && (
            <>
              <Separator orientation="vertical" className="mx-1 data-[orientation=vertical]:h-4" />
              <Badge variant="secondary" className="rounded-sm px-1 font-normal">
                {selected.length > 2 ? `${selected.length} selected` : options.filter(o => selected.includes(o.value)).map(o => o.label).join(', ')}
              </Badge>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-56 p-0" align="start">
        <Command>
          <CommandInput placeholder={title} />
          <CommandList>
            <CommandEmpty>No results</CommandEmpty>
            <CommandGroup>
              {options.map(o => {
                const on = selected.includes(o.value)
                return (
                  <CommandItem key={o.value} onSelect={() => toggle(o.value)}>
                    <div
                      className={cn(
                        'flex size-4 items-center justify-center rounded-[4px] border',
                        on ? 'border-primary bg-primary text-primary-foreground' : 'border-input [&_svg]:invisible',
                      )}
                    >
                      <Check className="size-3.5 text-current" />
                    </div>
                    <span className="truncate">{o.label}</span>
                    <span className="ml-auto font-mono text-xs text-muted-foreground">{o.count}</span>
                  </CommandItem>
                )
              })}
            </CommandGroup>
            {selected.length > 0 && (
              <>
                <CommandSeparator />
                <CommandGroup>
                  <CommandItem onSelect={() => onChange([])} className="justify-center text-center">
                    Clear filter
                  </CommandItem>
                </CommandGroup>
              </>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
