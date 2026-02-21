Example GET URL:

https://scotlis.ros.gov.uk/public/bff/land-register/addresses?postcode=ze1%200en

Output:

{
    "_embedded": {
        "addresses": [
            {
                "prettyPrint": "45 ST. OLAF STREET, LERWICK, SHETLAND, ZE1 0EN",
                "titles": [
                    {
                        "consideration": "No price available",
                        "considerationExplanation": "Your property documents include further information.",
                        "entryDate": "2023-03-30",
                        "titleNumber": "OAZ17228",
                        "addressIndex": 1,
                        "_links": {
                            "self": {
                                "href": "https://scotlis.ros.gov.uk/land-register/titles/OAZ17228"
                            }
                        }
                    }
                ]
            },
            {
                "prettyPrint": "46 ST. OLAF STREET, LERWICK, SHETLAND, ZE1 0EN",
                "titles": [
                    {
                        "consideration": "£310,000",
                        "entryDate": "2017-06-23",
                        "titleNumber": "OAZ7226",
                        "addressIndex": 1,
                        "_links": {
                            "self": {
                                "href": "https://scotlis.ros.gov.uk/land-register/titles/OAZ7226"
                            }
                        }
                    }
                ]
            },
            ... (etc)

