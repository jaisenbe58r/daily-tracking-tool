import { describe, expect, it } from 'vitest'
import { describeStyle, ownPart, signatureOf, styleFrom, withSignature, withoutSignature } from './style'

const SIG = 'Un saludo,\nJaime Sendra\nCTO · Captia\n+34 600 000 000'
const mail = (text: string, quote = true) =>
  `${text}\n\n${SIG}${quote ? '\n\nEl lun, 28 sept 2026 a las 10:00, Ana <ana@cliente.es> escribió:\n> ¿Me pasas el presupuesto?\n> Ana' : ''}`

describe('signatureOf', () => {
  it('finds the closing lines the sent mails share, verbatim, ignoring quoted history', () => {
    const bodies = [mail('Hola Ana,\n\nTe lo envío mañana.'), mail('Buenas Luis,\n\nPerfecto, lo vemos el jueves.', false), mail('Hola Marta, adjunto el plano.')]
    expect(signatureOf(bodies)).toBe(SIG)
  })

  it('is empty when mails share no closing, or there is only one', () => {
    expect(signatureOf(['Hola\nAdiós', 'Buenas\nHasta luego'])).toBe('')
    expect(signatureOf([mail('Hola')])).toBe('')
  })

  it('never takes a whole mail as the signature', () => {
    expect(signatureOf(['Gracias', 'Gracias'])).toBe('')
  })
})

describe('withSignature', () => {
  it('adds the signature once', () => {
    expect(withSignature('Hola Ana,\n\nTe lo envío mañana.', SIG)).toBe(`Hola Ana,\n\nTe lo envío mañana.\n\n${SIG}`)
    const signed = `Hola Ana,\n\nTe lo envío mañana.\n\n${SIG.replace('\n', '\n  ')}`
    expect(withSignature(signed, SIG)).toBe(signed)
    expect(withSignature('Hola', '')).toBe('Hola')
  })
})

describe('styleFrom', () => {
  it('keeps the address, the signature and short examples without it', () => {
    const style = styleFrom(
      [
        { sender: 'Jaime <Jaime@Captia.com>', plaintextBody: mail('Hola Ana,\n\nTe lo envío mañana sin falta.') },
        { sender: 'jaime@captia.com', plaintextBody: mail(`Buenas Luis,\n\n${'Mucho texto. '.repeat(60)}`) },
      ],
      1,
    )
    expect(style.me).toBe('jaime@captia.com')
    expect(style.signature).toBe(SIG)
    expect(style.examples[0]).toBe('Hola Ana,\n\nTe lo envío mañana sin falta.')
    expect(style.examples[1].length).toBeLessThanOrEqual(451)
    expect(describeStyle(style)).toContain(SIG)
    expect(describeStyle(null)).toBe('')
  })

  it('ownPart drops quotes and trailing blank lines', () => {
    expect(ownPart('Hola\n\n> citado\nFin\n\n')).toEqual(['Hola', '', 'Fin'])
    expect(withoutSignature(mail('Hola'), SIG)).toBe('Hola')
  })
})
