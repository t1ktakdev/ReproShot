pub fn discounted_total(price: i32, percent: i32) -> i32 {
    price - percent // Deliberate bug.
}

#[cfg(test)]
mod tests {
    #[test]
    fn applies_percentage_discount() {
        assert_eq!(super::discounted_total(50, 20), 40);
    }
}
