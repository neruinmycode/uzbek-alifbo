use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn convert(text: &str, mode: &str) -> String {
    transliterate(&[text], mode).pop().unwrap_or_default()
}

// Each replacement stays in the run that owned its first source character.
// The iterator still sees adjacent characters across formatting boundaries.
#[wasm_bindgen(js_name = convertRuns)]
pub fn convert_runs(runs: Vec<String>, mode: &str) -> Vec<String> {
    let runs: Vec<&str> = runs.iter().map(String::as_str).collect();
    transliterate(&runs, mode)
}

fn transliterate(runs: &[&str], mode: &str) -> Vec<String> {
    let mut output: Vec<_> = runs
        .iter()
        .map(|run| String::with_capacity(run.len()))
        .collect();
    let mut input = runs
        .iter()
        .enumerate()
        .flat_map(|(run, text)| text.chars().map(move |ch| (run, ch)))
        .peekable();
    let mut previous = '\0';

    while let Some((run, ch)) = input.next() {
        let next = input.peek().map_or('\0', |&(_, ch)| ch);
        let text = &mut output[run];
        match mode {
            "reverse" => reverse(text, ch, previous, next),
            "cyrillic" => cyrillic(text, ch, previous, next),
            _ => {
                if let Some(letter) = latin_pair(ch, next) {
                    text.push(letter);
                    input.next();
                } else {
                    text.push(ch);
                }
            }
        }
        previous = ch;
    }
    output
}

fn latin_pair(ch: char, next: char) -> Option<char> {
    if matches!(next, '\'' | '’' | '‘' | 'ʻ' | 'ʼ' | '`' | '´') {
        return match ch {
            'O' => Some('Ö'),
            'o' => Some('ö'),
            'G' => Some('Ğ'),
            'g' => Some('ğ'),
            _ => None,
        };
    }
    match (ch, next.to_ascii_lowercase()) {
        ('S', 'h') => Some('Ş'),
        ('s', 'h') => Some('ş'),
        ('C', 'h') => Some('Ç'),
        ('c', 'h') => Some('ç'),
        _ => None,
    }
}

fn is_upper(ch: char) -> bool {
    ch.to_uppercase().eq([ch]) && !ch.to_lowercase().eq([ch])
}

fn reverse(output: &mut String, ch: char, previous: char, next: char) {
    let replacement = match ch {
        'Ö' => "Oʻ",
        'ö' => "oʻ",
        'Ğ' => "Gʻ",
        'ğ' => "gʻ",
        'Ş' if is_upper(previous) || is_upper(next) => "SH",
        'Ş' => "Sh",
        'ş' => "sh",
        'Ç' if is_upper(previous) || is_upper(next) => "CH",
        'Ç' => "Ch",
        'ç' => "ch",
        _ => {
            output.push(ch);
            return;
        }
    };
    output.push_str(replacement);
}

fn cyrillic(output: &mut String, ch: char, previous: char, next: char) {
    let lower = ch.to_lowercase().next().unwrap_or(ch);
    let replacement = match lower {
        'а' => "a",
        'б' => "b",
        'в' => "v",
        'г' => "g",
        'д' => "d",
        'е' if cyrillic_e_after(previous) => "e",
        'е' => "ye",
        'ж' => "j",
        'з' => "z",
        'и' | 'ы' => "i",
        'й' => "y",
        'к' => "k",
        'л' => "l",
        'м' => "m",
        'н' => "n",
        'о' => "o",
        'п' => "p",
        'р' => "r",
        'с' => "s",
        'т' => "t",
        'у' => "u",
        'ф' => "f",
        'х' => "x",
        'ц' => "ts",
        'ч' => "ç",
        'ш' => "ş",
        'щ' => "şç",
        'э' => "e",
        'ю' => "yu",
        'я' => "ya",
        'ё' => "yo",
        'ў' => "ö",
        'ғ' => "ğ",
        'қ' => "q",
        'ҳ' => "h",
        'ъ' => "ʼ",
        'ь' => "",
        _ => {
            output.push(ch);
            return;
        }
    };

    let mut letters = replacement.chars();
    if ch != lower && (is_upper(previous) || is_upper(next)) {
        output.extend(letters.flat_map(char::to_uppercase));
    } else if ch != lower {
        if let Some(first) = letters.next() {
            output.extend(first.to_uppercase());
        }
        output.extend(letters);
    } else {
        output.push_str(replacement);
    }
}

fn cyrillic_e_after(ch: char) -> bool {
    let upper = ch.to_uppercase().next().unwrap_or(ch);
    matches!(upper, 'А'..='Я' | 'Ё' | 'Ў' | 'Ғ' | 'Қ' | 'Ҳ')
        && !matches!(
            upper,
            'А' | 'О' | 'У' | 'И' | 'Э' | 'Е' | 'Ё' | 'Ю' | 'Я' | 'Ы' | 'Ў' | 'Ъ' | 'Ь'
        )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latin_capitalization_and_all_apostrophes() {
        for apostrophe in ['\'', '’', '‘', 'ʻ', 'ʼ', '`', '´'] {
            assert_eq!(
                convert(
                    &format!(
                        "O{apostrophe} o{apostrophe} G{apostrophe} g{apostrophe} ma{apostrophe}no"
                    ),
                    "latin"
                ),
                format!("Ö ö Ğ ğ ma{apostrophe}no")
            );
        }
        assert_eq!(
            convert("SH Sh sH sh CH Ch cH ch ng", "latin"),
            "Ş Ş ş ş Ç Ç ç ç ng"
        );
    }

    #[test]
    fn contextual_cyrillic_and_capitalization() {
        assert_eq!(
            convert(
                "Ел ЕЛ кел поезда съезд объект ё Ё ЁШ Юл ЮЛ Ща ЩА ЎЗБЕКИСТОН Ғ, Ш, Ч 😀",
                "cyrillic"
            ),
            "Yel YEL kel poyezda sʼyezd obʼyekt yo Yo YOŞ Yul YUL Şça ŞÇA ÖZBEKISTON Ğ, Ş, Ç 😀"
        );
    }

    #[test]
    fn reverse_uses_original_neighbors() {
        assert_eq!(
            convert("Şahar ŞARQ aŞB AŞa Ç ÇIROQ uç ÖöĞğ ÒŞ 😀Şa", "reverse"),
            "Shahar SHARQ aSHB ASHa Ch CHIROQ uch OʻoʻGʻgʻ ÒSH 😀Sha"
        );
    }

    #[test]
    fn conversion_preserves_run_ownership() {
        assert_eq!(
            transliterate(&["S", "", "hahar O", "‘zbek"], "latin"),
            ["Ş", "", "ahar Ö", "zbek"]
        );
        assert_eq!(transliterate(&["Ş", "ARQ"], "reverse"), ["SH", "ARQ"]);
        assert_eq!(transliterate(&["к", "е"], "cyrillic"), ["k", "e"]);
    }
}
