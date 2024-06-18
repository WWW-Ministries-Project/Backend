//this function takes a text and change it to sentenced case format
export const toSentenceCase = (text: string) => {
  if (text) return text[0].toUpperCase() + text.substring(1).toLowerCase();
  return text;
};

//this function takes a group of words separated by space and change it to Capitalized each word format
export const toCapitalizeEachWord = (words: string) => {
  if (words) {
    words = words
      .split(" ")
      .map((item) => toSentenceCase(item))
      .join(" ");
  }
  return words;
};
