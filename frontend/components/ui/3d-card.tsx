"use client"

import { createContext, useContext, useRef, useState, useCallback, type MouseEvent, type ReactNode } from "react"

interface ContainerContextValue {
  rotateX: number
  rotateY: number
  isHovered: boolean
}

const ContainerContext = createContext<ContainerContextValue>({
  rotateX: 0,
  rotateY: 0,
  isHovered: false,
})

export function CardContainer({
  children,
  className = "",
  containerClassName = "",
}: {
  children: ReactNode
  className?: string
  containerClassName?: string
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [state, setState] = useState<ContainerContextValue>({
    rotateX: 0,
    rotateY: 0,
    isHovered: false,
  })

  const handleMouseMove = useCallback((e: MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current) return
    const { left, top, width, height } = containerRef.current.getBoundingClientRect()
    const x = (e.clientX - left - width / 2) / 20
    const y = (e.clientY - top - height / 2) / 20
    setState({ rotateX: y, rotateY: -x, isHovered: true })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setState({ rotateX: 0, rotateY: 0, isHovered: false })
  }, [])

  return (
    <ContainerContext.Provider value={state}>
      <div className={containerClassName} style={{ perspective: "1000px" }}>
        <div
          ref={containerRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className={className}
          style={{
            transformStyle: "preserve-3d",
            transform: `rotateY(${state.rotateY}deg) rotateX(${state.rotateX}deg)`,
            transition: state.isHovered
              ? "transform 0.1s ease-out"
              : "transform 0.5s cubic-bezier(0.22, 1, 0.36, 1)",
          }}
        >
          {children}
        </div>
      </div>
    </ContainerContext.Provider>
  )
}

export function CardBody({
  children,
  className = "",
}: {
  children: ReactNode
  className?: string
}) {
  return (
    <div
      className={className}
      style={{ transformStyle: "preserve-3d" }}
    >
      {children}
    </div>
  )
}

export function CardItem({
  children,
  className = "",
  translateZ = 0,
  as: Tag = "div",
  ...rest
}: {
  children: ReactNode
  className?: string
  translateZ?: number
  as?: keyof HTMLElementTagNameMap
  [key: string]: unknown
}) {
  const { isHovered } = useContext(ContainerContext)
  const Component = Tag as any

  return (
    <Component
      className={className}
      style={{
        transformStyle: "preserve-3d" as const,
        transform: isHovered ? `translateZ(${translateZ}px)` : "translateZ(0px)",
        transition: "transform 0.2s ease-out",
      }}
      {...rest}
    >
      {children}
    </Component>
  )
}
