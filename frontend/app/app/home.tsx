import {
  View,
  Text,
  StyleSheet,
  ImageBackground,
  ActivityIndicator,
  TouchableOpacity,
  Image,
} from "react-native";

import { useEffect, useState } from "react";
import { useRouter } from "expo-router";
import { auth, db } from "../firebase";
import { doc, getDoc, setDoc } from "firebase/firestore";
import * as ImagePicker from "expo-image-picker";
import axios from "axios";

export default function Home() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [userData, setUserData] = useState<any>(null);
  const [payslipUploaded, setPayslipUploaded] = useState(false);
  const [credits, setCredits] = useState<number>(0);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const user = auth.currentUser;
        if (!user) return;

        const docRef = doc(db, "users", user.uid);
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
          const data = docSnap.data();

          let isActive = data.policyActive;

          // 🔥 EXPIRY LOGIC
          if (data.lastPaymentDate) {
            const lastDate = data.lastPaymentDate.toDate
              ? data.lastPaymentDate.toDate()
              : new Date(data.lastPaymentDate);

            const now = new Date();
            const diffDays =
              (now.getTime() - lastDate.getTime()) / (1000 * 60 * 60 * 24);

            if (diffDays > 14) {
              isActive = false;
              await setDoc(
                doc(db, "users", user.uid),
                { policyActive: false },
                { merge: true }
              );
            }
          }

          setUserData({
            ...data,
            policyActive: isActive,
          });
          setCredits(data.credits || 0);
        }
      } catch (error) {
        console.log(error);
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, []);

  // 🌍 REAL ENVIRONMENT API (CHENNAI)
  const fetchEnvData = async () => {
    const API_KEY = "37f63416af21b6fc12124708ac26df4c";
    const city = userData?.location || "Chennai";
    try {
      const weatherRes = await fetch(
        `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}&units=metric`
      );
      const weatherData = await weatherRes.json();

      const temp = weatherData.main.temp;
      const rain = weatherData.rain ? weatherData.rain["1h"] || 0 : 0;
      const lat = weatherData.coord.lat;
      const lon = weatherData.coord.lon;

      const aqiRes = await fetch(
        `https://api.openweathermap.org/data/2.5/air_pollution?lat=${lat}&lon=${lon}&appid=${API_KEY}`
      );
      const aqiData = await aqiRes.json();

      const aqi = aqiData.list[0].main.aqi * 50;

      return { rain, temperature: temp, aqi };
    } catch (error) {
      console.log("Env error:", error);
      return { rain: 0, temperature: 30, aqi: 50 };
    }
  };

  // 🧑‍💻 ADMIN DATA
  const fetchAdminData = async () => {
    const res = await fetch("http://192.168.137.1:3000/admin");
    return await res.json();
  };

  useEffect(() => {
  const runDailyTrigger = async () => {
    console.log(" runDailyTrigger started");

    // const env = {
    //   rain: 160,
    //   temperature: 40,
    //   aqi: 20,
    // };

    // const admin = {
    //   curfew: 0,
    //   festival: 1,
    // };

    try {
      const user = auth.currentUser;
      if (!user) return;

      const userRef = doc(db, "users", user.uid);
      const snap = await getDoc(userRef);
      if (!snap.exists()) return;

      const data = snap.data();

      
      const isSameDay = (d1: Date, d2: Date) =>
        d1.toDateString() === d2.toDateString();

      const lastTrigger = data.lastTriggerDate
        ? new Date(data.lastTriggerDate.seconds * 1000)
        : null;

      if (lastTrigger && isSameDay(lastTrigger, new Date())) {
        console.log(" Already triggered today");
        return;
      }

      const history = data.triggerHistory || [];

      const now = new Date();
      const startOfWeek = new Date(now);
      startOfWeek.setDate(now.getDate() - now.getDay());
      startOfWeek.setHours(0, 0, 0, 0);

      const triggersThisWeek = history.filter((t: any) => {
        const tDate = t.date?.seconds
          ? new Date(t.date.seconds * 1000)
          : new Date(t.date);
        return tDate >= startOfWeek;
      });

      if (triggersThisWeek.length >= 3) {
        console.log(" Weekly limit reached");
        return;
      }
        const env = await fetchEnvData(); 
        const admin = await fetchAdminData();

      const maxPayout: any = {
        low: 45,
        medium: 79,
        high: 108,
      };

      const contribution: any = {
        lowRain: 0.5,
        highRain: 1.0,
        heat: 0.5,
        aqi: 0.5,
        curfew: 1.0,
        festival: 0.5,
      };

      const risk = data.riskLevel || "low";
      const max = maxPayout[risk];

      let factors: any[] = [];

      if (env.rain >= 80 && env.rain <= 100)
        factors.push({ value: contribution.lowRain, reason: "Low Rain" });

      if (env.rain > 100)
        factors.push({ value: contribution.highRain, reason: "High Rain" });

      if (env.temperature > 40)
        factors.push({ value: contribution.heat, reason: "Heat" });

      if (env.aqi > 150)
        factors.push({ value: contribution.aqi, reason: "AQI" });

      if (admin.curfew === 1)
        factors.push({ value: contribution.curfew, reason: "Curfew" });

      if (admin.festival === 1)
        factors.push({ value: contribution.festival, reason: "Festival" });

      if (factors.length === 0) {
        console.log(" No trigger conditions");
        return;
      }

      const best = factors.reduce((a, b) =>
        b.value > a.value ? b : a
      );

      const finalPayout = Math.round(best.value * max);
      const newCredits = (data.credits || 0) + finalPayout;

      const updatedHistory = [
        ...(data.triggerHistory || []),
        {
          date: new Date(),
          amount: finalPayout,
          reason: best.reason,
        },
      ];

      await setDoc(
        userRef,
        {
          credits: newCredits,
          lastTriggerDate: new Date(),
          triggerHistory: updatedHistory,
        },
        { merge: true }
      );

      setCredits(newCredits);

      setUserData((prev: any) => ({
        ...prev,
        credits: newCredits,
        triggerHistory: updatedHistory,
      }));

      console.log(
        ` Trigger: ${best.reason} → ₹${finalPayout} (Risk: ${risk})`
      );
    } catch (err) {
      console.log("Trigger error:", err);
    }
  };

  runDailyTrigger();
}, []);

  const pickImage = async () => {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"],
      quality: 1,
    });

    if (!result.canceled) {
      const imageUri = result.assets[0].uri;
      const response = await fetch(imageUri);
      const blob = await response.blob();

      const formData = new FormData();
      formData.append("file", blob, "payslip.jpg");

      try {
        const res = await axios.post(
          "http://192.168.137.1:3000/upload-payslip",
          formData
        );

        setPayslipUploaded(true);
        setUserData((prev: any) => ({
          ...prev,
          salary: res.data.salary,
        }));
      } catch (err) {
        console.log("UPLOAD ERROR:", err);
      }
    }
  };
  const getWeeklyTriggerCount = () => {
  if (!userData?.triggerHistory) return 0;

  const now = new Date();
  const start = new Date(now);
  start.setDate(now.getDate() - now.getDay());
  start.setHours(0, 0, 0, 0);

  return userData.triggerHistory.filter((t: any) => {
    let d;

    if (t.date?.seconds) {
      d = new Date(t.date.seconds * 1000); // Firestore timestamp
    } else {
      d = new Date(t.date); // JS Date
    }

    return d >= start;
  }).length;
};
  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color="#fff" />
      </View>
    );
  }

  return (
    <ImageBackground
      source={require("../assets/images/bg1.jpg")}
      style={{ flex: 1 }}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.title}>Welcome 👋</Text>

          {/* UPLOAD */}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: "#007bff" }]}
            onPress={pickImage}
          >
            <Text style={styles.buttonText}>
              {payslipUploaded ? "Payslip Uploaded ✅" : "Upload Payslip"}
            </Text>
          </TouchableOpacity>

          {/* POLICY STATUS */}
          <View style={styles.card}>
            <Text style={styles.label}>Policy Status</Text>
            <Text style={styles.value}>
              {userData?.policyActive ? "Active " : "Inactive "}
            </Text>
          </View>

          {/* TOTAL PAID */}
          <View style={styles.card}>
            <Text style={styles.label}>Total Paid</Text>
            <Text style={styles.value}>₹{userData?.totalPaid || 0}</Text>
          </View>

          {/* CREDITS */}
          <View style={styles.card}>
            <Text style={styles.label}>Credits</Text>
            <Text style={styles.value}>{credits}</Text>
          </View>

          <Text style={styles.value}>
            {getWeeklyTriggerCount()} / 3
          </Text>


          {/* PAYMENT */}
          <TouchableOpacity
            style={[styles.button, { opacity: payslipUploaded ? 1 : 0.5 }]}
            onPress={() => {
              if (!payslipUploaded) {
                alert("Upload payslip first!");
                return;
              }

              router.push({
                pathname: "/payment",
                params: {
                  type: "weekly",
                  salary: userData?.salary,
                },
              });
            }}
          >
            <Text style={styles.buttonText}>Pay Weekly Premium</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.button, { backgroundColor: "#333" }]}
            onPress={() => router.push("/profile")}
          >
            <Text style={styles.buttonText}>Edit Profile</Text>
          </TouchableOpacity>

          {/*  POLICY DETAILS BUTTON */}
          <TouchableOpacity
            style={[styles.button, { backgroundColor: "#444" }]}
            onPress={() => router.push("/policy")}
          >
            <Text style={styles.buttonText}>View Policy</Text>
          </TouchableOpacity>
        </View>

        {!userData?.policyActive && (
          <TouchableOpacity
            style={[styles.button, { backgroundColor: "#ffaa00" }]}
            onPress={() => router.push("/payment?type=reactivation")}
          >
            <Text style={styles.buttonText}>Reactivate Policy (₹250)</Text>
          </TouchableOpacity>
        )}
      </View>
    </ImageBackground>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.6)",
    justifyContent: "center",
  },
  container: {
    padding: 20,
  },
  title: {
    fontSize: 28,
    color: "#fff",
    fontWeight: "bold",
    marginBottom: 20,
  },
  card: {
    backgroundColor: "#222",
    padding: 20,
    borderRadius: 15,
    marginBottom: 15,
  },
  label: {
    color: "#aaa",
    fontSize: 14,
  },
  value: {
    color: "#00ffcc",
    fontSize: 20,
    fontWeight: "bold",
    marginTop: 5,
  },
  button: {
    backgroundColor: "#ff5a5f",
    padding: 14,
    borderRadius: 10,
    alignItems: "center",
    marginTop: 15,
  },
  buttonText: {
    color: "#fff",
    fontWeight: "bold",
  },
  loader: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#000",
  },
});