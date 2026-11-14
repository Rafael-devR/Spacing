//! Operações com o mesmo resultado que no JavaScript (o jogo em TypeScript é a referência: docs/design/PORTE_RUST.md).
//! `Math.round` e `Math.hypot` do V8 não são iguais às do Rust; diferenças de um bit mudam um bloco no `floor`.

/// `Math.round`: arredonda para cima no meio (-2.5 → -2), ao contrário de `f64::round`.
#[inline]
pub fn round(x: f64) -> f64 {
    let r = x.floor();
    if x - r >= 0.5 {
        r + 1.0
    } else {
        r
    }
}

/// `Math.hypot(a, b)` do V8: normaliza pelo maior e soma com compensação de Kahan.
#[inline]
pub fn hypot(a: f64, b: f64) -> f64 {
    hypot_n(&[a, b])
}

#[inline]
pub fn hypot3(a: f64, b: f64, c: f64) -> f64 {
    hypot_n(&[a, b, c])
}

fn hypot_n(v: &[f64]) -> f64 {
    let mut max = 0.0f64;
    let mut nan = false;
    for &x in v {
        let a = x.abs();
        if a.is_nan() {
            nan = true;
        } else if a > max {
            max = a;
        }
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if nan {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0f64;
    let mut comp = 0.0f64;
    for &x in v {
        let n = x.abs() / max;
        let summand = n * n - comp;
        let pre = sum + summand;
        comp = (pre - sum) - summand;
        sum = pre;
    }
    sum.sqrt() * max
}

/// `x | 0` de um número JavaScript (inteiro de 32 bits, com volta).
#[inline]
pub fn to_i32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    let m = x.trunc().rem_euclid(4294967296.0);
    (m as u64 as u32) as i32
}

/// `smoothstep` do core/noise.ts
#[inline]
pub fn smoothstep(a: f64, b: f64, x: f64) -> f64 {
    let t = ((x - a) / (b - a)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn round_like_js() {
        assert_eq!(round(-2.5), -2.0);
        assert_eq!(round(2.5), 3.0);
        assert_eq!(round(-0.4), 0.0);
        assert_eq!(round(1.49), 1.0);
    }
    #[test]
    fn hypot_basics() {
        assert_eq!(hypot(3.0, 4.0), 5.0);
        assert_eq!(hypot(0.0, 0.0), 0.0);
    }
    #[test]
    fn int32_wrap() {
        assert_eq!(to_i32(2147483648.0), -2147483648);
        assert_eq!(to_i32(-1.7), -1);
    }
}
